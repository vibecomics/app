import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { parseS3ConnectionString } from '../s3/s3Config';
import { errorMessage } from '../utils/errors';
import Modal from './Modal';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

/** Connect Google Drive via the OAuth device flow: a code and URL to approve from any device. */
export function ConnectDriveModal({
  deviceCode,
  waiting,
  onClose,
}: {
  deviceCode: DeviceCodeInfo | null;
  waiting: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title="Connect Google Drive" label="Connect Google Drive" onClose={onClose}>
      {deviceCode ? (
        <>
          <p className="mb-1">
            <strong>On your phone or another browser, go to:</strong>
          </p>
          <p>
            <a href={deviceCode.url} target="_blank" rel="noreferrer">
              {deviceCode.url}
            </a>
          </p>
          <p className="mb-1">Enter this code:</p>
          <p className="h3 fw-bold text-center">{deviceCode.code}</p>
          <p className="mb-0 text-muted small">
            Expires in {Math.round(deviceCode.expiresInSeconds / 60)} minutes. This closes
            automatically once approved.
          </p>
        </>
      ) : (
        <p className="d-flex align-items-center gap-2 mb-0 text-muted">
          <Spinner />
          {waiting ? 'Starting…' : 'Preparing to connect…'}
        </p>
      )}
    </Modal>
  );
}

/**
 * Connect an S3-compatible bucket (self-hosted, or real AWS S3/R2/B2) by its endpoint,
 * credentials and bucket. The assembled connection string, credentials included, is remembered
 * in this browser (see storage/connections.ts) so it reconnects automatically next time — this
 * form only needs filling in once per bucket, per browser.
 */
export function ConnectS3Modal({
  onConnect,
  onClose,
}: {
  onConnect: (connectionString: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(
    's3://changeme:changeme@devserver:9000/vibecomics?tls=1&region=us-east-1'
  );
  const [error, setError] = useState('');
  const connecting = useBusy();

  const valid = url.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError('');
    try {
      const connectionString = url.trim();
      parseS3ConnectionString(connectionString); // throws if malformed
      await connecting.run(() => onConnect(connectionString));
    } catch (e2) {
      setError(errorMessage(e2));
    }
  }

  return (
    <Modal
      title="Connect an S3-compatible bucket"
      label="Connect an S3-compatible bucket"
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-label" htmlFor="s3-url">
          S3 URL
        </label>
        <input
          id="s3-url"
          className="form-control"
          placeholder="s3://accessKeyId:secretAccessKey@host:port/bucket"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          disabled={connecting.busy}
        />
        <details className="form-text">
          <summary>Format</summary>
          <code>s3://accessKeyId[:secretAccessKey]@host[:port]/bucket?region=...&amp;tls=1</code>
          <br />
          Region matters for real AWS buckets (must match where the bucket lives); for self-hosted
          servers like RustFS or MinIO it's accepted but not enforced.
        </details>
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        <div className="d-flex justify-content-end gap-2 mt-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={connecting.busy || !valid}>
            {connecting.busy && <Spinner />}
            Connect
          </button>
        </div>
      </form>
    </Modal>
  );
}
