import {
  AuthResponse,
  ErrorResponse,
  Recording,
  RecordingPage,
  RecordingUrl,
  UploadTarget,
} from '@mc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newUser, type TestApp } from '../../test/testApp';

const MiB = 1024 * 1024;
const PART = 5 * MiB; // S3's minimum part size, so multi-part tests stay small

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    RECORDING_PART_BYTES: String(PART),
    RECORDING_QUOTA_BYTES: String(12 * MiB),
  });
});

afterAll(async () => {
  await t.app.close();
});

async function signedUpUser(app = t.app) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newUser() });
  return { authorization: `Bearer ${AuthResponse.parse(res.json()).accessToken}` };
}

const api = (
  headers: Record<string, string>,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers, ...(payload && { payload }) });

/** PUTs each part to its presigned S3 URL, like the browser does, and returns the parts list. */
async function uploadParts(target: UploadTarget, body: Uint8Array) {
  return Promise.all(
    target.partUrls.map(async ({ partNumber, url }) => {
      const chunk = body.subarray((partNumber - 1) * target.partSize, partNumber * target.partSize);
      const res = await fetch(url, { method: 'PUT', body: chunk });
      expect(res.status).toBe(200);
      return { partNumber, etag: res.headers.get('etag')! };
    }),
  );
}

async function record(headers: Record<string, string>, sizeBytes: number) {
  const body = new Uint8Array(sizeBytes).map((_, i) => i % 251);
  const created = await api(headers, 'POST', '/recordings', {
    mimeType: 'video/webm;codecs=vp9,opus',
    sizeBytes,
    durationMs: 3_000,
  });
  expect(created.statusCode).toBe(201);
  const target = UploadTarget.parse(created.json());
  const parts = await uploadParts(target, body);
  return { target, parts, body };
}

describe('recording upload', () => {
  it('uploads in parts straight to S3, completes, and lists the recording', async () => {
    const headers = await signedUpUser();
    const { target, parts } = await record(headers, PART + 1234); // 2 parts

    expect(target.partUrls.map((p) => p.partNumber)).toEqual([1, 2]);
    const done = await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, {
      parts,
    });
    expect(done.statusCode).toBe(200);
    expect(Recording.parse(done.json())).toMatchObject({ status: 'ready', sizeBytes: PART + 1234 });

    const list = RecordingPage.parse((await api(headers, 'GET', '/recordings')).json());
    expect(list.items.map((r) => r.id)).toEqual([target.recordingId]);
  });

  it('completing twice is safe (a retried request whose first response was lost)', async () => {
    const headers = await signedUpUser();
    const { target, parts } = await record(headers, 1000);
    const url = `/recordings/${target.recordingId}/complete`;

    expect((await api(headers, 'POST', url, { parts })).statusCode).toBe(200);
    const again = await api(headers, 'POST', url, { parts });
    expect(again.statusCode).toBe(200);
    expect(Recording.parse(again.json()).status).toBe('ready');
  });

  it('serves a playable signed URL, and a download URL with a filename', async () => {
    const headers = await signedUpUser();
    const { target, parts, body } = await record(headers, 2048);
    await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, { parts });

    const play = RecordingUrl.parse(
      (await api(headers, 'GET', `/recordings/${target.recordingId}/url`)).json(),
    );
    const video = await fetch(play.url);
    expect(video.status).toBe(200);
    expect(new Uint8Array(await video.arrayBuffer())).toEqual(body);

    const download = RecordingUrl.parse(
      (await api(headers, 'GET', `/recordings/${target.recordingId}/url?download=1`)).json(),
    );
    expect((await fetch(download.url)).headers.get('content-disposition')).toMatch(
      /^attachment; filename="music-composer-.*\.webm"$/,
    );
  });

  it('issues fresh part URLs for resuming a pending upload', async () => {
    const headers = await signedUpUser();
    const created = UploadTarget.parse(
      (
        await api(headers, 'POST', '/recordings', {
          mimeType: 'video/webm',
          sizeBytes: 10,
          durationMs: 1,
        })
      ).json(),
    );

    const resumed = await api(headers, 'POST', `/recordings/${created.recordingId}/upload-urls`);
    expect(resumed.statusCode).toBe(200);
    const target = UploadTarget.parse(resumed.json());
    const parts = await uploadParts(target, new Uint8Array(10));
    expect(
      (await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, { parts }))
        .statusCode,
    ).toBe(200);
  });

  it('rejects completion when the uploaded size differs from the declared size, and frees the quota', async () => {
    const headers = await signedUpUser();
    const created = UploadTarget.parse(
      (
        await api(headers, 'POST', '/recordings', {
          mimeType: 'video/webm',
          sizeBytes: 5000,
          durationMs: 1,
        })
      ).json(),
    );
    const parts = await uploadParts(created, new Uint8Array(100)); // fewer bytes than declared

    const res = await api(headers, 'POST', `/recordings/${created.recordingId}/complete`, {
      parts,
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorResponse.parse(res.json()).code).toBe('UPLOAD_INCOMPLETE');
    expect((await api(headers, 'GET', `/recordings/${created.recordingId}/url`)).statusCode).toBe(
      404,
    );
  });

  it('rejects completion with a bad part list', async () => {
    const headers = await signedUpUser();
    const { target } = await record(headers, 1000);

    const res = await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, {
      parts: [{ partNumber: 1, etag: '"not-the-etag"' }],
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorResponse.parse(res.json()).code).toBe('UPLOAD_INCOMPLETE');
  });

  it('validates the declared format and size', async () => {
    const headers = await signedUpUser();
    for (const payload of [
      { mimeType: 'image/png', sizeBytes: 10, durationMs: 1 },
      { mimeType: 'video/webm', sizeBytes: 0, durationMs: 1 },
      { mimeType: 'video/webm', sizeBytes: 500 * MiB, durationMs: 1 },
      { mimeType: 'video/webm', sizeBytes: 10, durationMs: 60 * 60 * 1000 },
    ]) {
      expect((await api(headers, 'POST', '/recordings', payload)).statusCode).toBe(400);
    }
  });
});

describe('storage quota', () => {
  it('refuses a recording that would exceed the quota, and deleting frees space', async () => {
    const headers = await signedUpUser(); // quota is 12 MiB in this suite
    const first = UploadTarget.parse(
      (
        await api(headers, 'POST', '/recordings', {
          mimeType: 'video/webm',
          sizeBytes: 8 * MiB,
          durationMs: 1,
        })
      ).json(),
    );

    const over = await api(headers, 'POST', '/recordings', {
      mimeType: 'video/webm',
      sizeBytes: 5 * MiB,
      durationMs: 1,
    });
    expect(over.statusCode).toBe(409);
    expect(ErrorResponse.parse(over.json()).code).toBe('QUOTA_EXCEEDED');

    expect((await api(headers, 'DELETE', `/recordings/${first.recordingId}`)).statusCode).toBe(204);
    const fits = await api(headers, 'POST', '/recordings', {
      mimeType: 'video/webm',
      sizeBytes: 5 * MiB,
      durationMs: 1,
    });
    expect(fits.statusCode).toBe(201);
  });
});

describe('access control', () => {
  it('requires sign-in', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/recordings' })).statusCode).toBe(401);
  });

  it("never exposes another user's recording", async () => {
    const owner = await signedUpUser();
    const other = await signedUpUser();
    const { target, parts } = await record(owner, 1000);
    await api(owner, 'POST', `/recordings/${target.recordingId}/complete`, { parts });
    const id = target.recordingId;

    expect((await api(other, 'GET', `/recordings/${id}/url`)).statusCode).toBe(404);
    expect((await api(other, 'POST', `/recordings/${id}/complete`, { parts })).statusCode).toBe(
      404,
    );
    expect((await api(other, 'POST', `/recordings/${id}/upload-urls`)).statusCode).toBe(404);
    expect(RecordingPage.parse((await api(other, 'GET', '/recordings')).json()).items).toEqual([]);
    // Delete by a stranger is a silent no-op; the owner still has it.
    expect((await api(other, 'DELETE', `/recordings/${id}`)).statusCode).toBe(204);
    expect((await api(owner, 'GET', `/recordings/${id}/url`)).statusCode).toBe(200);
  });
});

describe('listing and deleting', () => {
  it('pages newest first and hides pending uploads', async () => {
    const headers = await signedUpUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { target, parts } = await record(headers, 100 + i);
      await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, { parts });
      ids.push(target.recordingId);
    }
    await api(headers, 'POST', '/recordings', {
      mimeType: 'video/webm',
      sizeBytes: 10,
      durationMs: 1,
    }); // pending

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/recordings?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = RecordingPage.parse((await api(headers, 'GET', url)).json());
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...ids].reverse());
  });

  it('deletes the video so its URL stops working, and is idempotent', async () => {
    const headers = await signedUpUser();
    const { target, parts } = await record(headers, 1000);
    await api(headers, 'POST', `/recordings/${target.recordingId}/complete`, { parts });
    const { url } = RecordingUrl.parse(
      (await api(headers, 'GET', `/recordings/${target.recordingId}/url`)).json(),
    );

    expect((await api(headers, 'DELETE', `/recordings/${target.recordingId}`)).statusCode).toBe(
      204,
    );
    expect((await fetch(url)).status).toBe(404);
    expect((await api(headers, 'DELETE', `/recordings/${target.recordingId}`)).statusCode).toBe(
      204,
    );
    expect((await api(headers, 'GET', `/recordings/${target.recordingId}/url`)).statusCode).toBe(
      404,
    );
  });
});
