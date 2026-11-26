/**
 * Connections to an S3-compatible bucket (any self-hosted server, or real AWS S3 / R2 / B2,
 * by connection string alone — see s3Config.ts). No OAuth: an accessKeyId/secretAccessKey pair,
 * checked once with HeadBucket. Several can be connected at once (see storage/connections.ts).
 */
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { StorageBackendImpl } from '../storage/backend';
import { createS3Client } from './s3Client';
import { s3Label } from './s3Config';
import type { S3Credentials, S3TargetConfig } from './s3Config';
import { createS3Rest } from './s3Rest';

/**
 * Turn a HeadBucket failure into a message that names the likely cause, instead of a bare SDK
 * error — the three cases people actually hit are a wrong bucket name, wrong credentials and a
 * TLS certificate the client doesn't trust (common for a self-hosted server's self-signed cert),
 * and each looks completely different from the others at this layer:
 *  - wrong bucket / wrong credentials get an HTTP response (404 / 403 — S3 gives HeadBucket no
 *    body to tell them apart beyond the status code, see AWS's own HeadBucket docs), so
 *    `$metadata.httpStatusCode` is set.
 *  - a TLS failure (and other connect-level failures: refused, DNS, timeout) never gets an HTTP
 *    response at all, so that field is absent and Node's low-level error `code` is the only signal.
 *  - in a browser, a failed fetch is just "Failed to fetch" with no code — browsers deliberately
 *    withhold the reason (cert vs CORS vs host-down) from script for security, so that case stays
 *    a guess naming the possibilities rather than a diagnosis.
 */
function describeS3HealthError(e: unknown, config: S3TargetConfig): string {
  const prefix = `Could not reach bucket "${config.bucket}" at ${config.endpoint}`;
  const status = (e as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  const detail = e instanceof Error ? e.message : String(e);

  if (status === 404) {
    return `${prefix}: no such bucket (404 Not Found). Check the bucket name.`;
  }
  if (status === 403) {
    return `${prefix}: access denied (403 Forbidden). Check the access key and secret.`;
  }
  if (status !== undefined) {
    return `${prefix}: server responded with HTTP ${status}. ${detail}`;
  }

  const code =
    (e as { code?: string; cause?: { code?: string } } | undefined)?.code ??
    (e as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code && /CERT|SSL|TLS/i.test(code)) {
    return (
      `${prefix}: the TLS certificate was rejected (${code}). If this server uses a ` +
      `self-signed certificate (common for a self-hosted RustFS/MinIO server), the ` +
      `connection needs a certificate your browser or runtime actually trusts.`
    );
  }
  if (code === 'ECONNREFUSED') return `${prefix}: connection refused. Check the host and port.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return `${prefix}: host not found. Check the host.`;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET')
    return `${prefix}: connection timed out. Check the host, port, and that tls matches the server.`;
  if (/certificate|ssl|tls/i.test(detail)) {
    return `${prefix}: the TLS certificate was rejected. ${detail}`;
  }
  return (
    `${prefix}: ${detail}. This can mean an untrusted TLS certificate, the wrong host/port, ` +
    `or http/tls not matching how the server is actually running.`
  );
}

/** Check that the bucket is reachable with these credentials before adding the connection. */
export async function checkS3Health(
  config: S3TargetConfig,
  credentials: S3Credentials
): Promise<void> {
  const client = createS3Client(config, credentials);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (e) {
    throw new Error(describeS3HealthError(e, config));
  } finally {
    client.destroy();
  }
}

/** One connected bucket's `StorageBackendImpl`, bound to a fixed config and credentials. */
export function createS3Backend(
  config: S3TargetConfig,
  credentials: S3Credentials
): StorageBackendImpl {
  let client: S3Client | null = createS3Client(config, credentials);
  const rest = createS3Rest({ getClient: () => client, bucket: config.bucket });
  return {
    label: s3Label(config),
    listProjectFolders: rest.listProjectFolders,
    ensureProjectFolder: rest.ensureProjectFolder,
    uploadImage: rest.uploadImage,
    trashFile: rest.trashFile,
    downloadFile: rest.downloadFile,
    findFileByName: rest.findFileByName,
    listFolderFiles: rest.listFolderFiles,
    saveProjectJson: rest.saveProjectJson,
    loadProjectFile: rest.loadProjectFile,
    hasAccess: () => client !== null,
    disconnect: () => {
      client?.destroy();
      client = null;
    },
  };
}
