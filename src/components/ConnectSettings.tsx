import { useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import { errorMessage } from '../utils/errors';
import { ConnectDriveModal, ConnectS3Modal } from './ConnectModals';
import { TrashIcon } from './Icons';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

interface Props {
  connections: StorageConnectionInfo[];
  deviceCode: DeviceCodeInfo | null;
  /** Called after a connect/disconnect that this card already knows succeeded, for a snappier
   * refresh than waiting on the next `connections` prop update. */
  onChange: () => void;
  /** Skip the card and heading: the caller already has its own section heading. */
  bare?: boolean;
}

/**
 * The "Storage" settings: the storage that is connected now, with a Disconnect button for each,
 * and below it the "Add" buttons. Each opens a popup that walks through connecting: Google Drive
 * via the OAuth device-code flow (see drive/driveClient.ts), or an S3-compatible bucket (see s3/)
 * by its endpoint, credentials and bucket. Any number of buckets can be added.
 */
export default function ConnectSettings({ connections, deviceCode, onChange, bare }: Props) {
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showS3Modal, setShowS3Modal] = useState(false);
  const [error, setError] = useState('');
  const device = useBusy();
  const disconnecting = useBusy();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const live = connections.filter((c) => c.connected);
  const drive = live.find((c) => c.kind === 'drive');

  // Close the Drive popup once the device flow finishes, one way or another (App.tsx clears
  // deviceCode in both cases); a success shows up as a new row via the connections prop.
  const [prevDeviceCode, setPrevDeviceCode] = useState(deviceCode);
  if (deviceCode !== prevDeviceCode) {
    setPrevDeviceCode(deviceCode);
    if (deviceCode === null) setShowDriveModal(false);
  }

  function startDrive() {
    setError('');
    setShowDriveModal(true);
    void device.run(() =>
      cb()
        .storage.connect('drive')
        .catch((e: unknown) => {
          setError(errorMessage(e));
          setShowDriveModal(false);
        })
    );
  }

  async function connectS3(connectionString: string) {
    await cb().storage.connect(connectionString);
    setShowS3Modal(false);
    onChange();
  }

  async function disconnect(id: string) {
    setError('');
    setDisconnectingId(id);
    try {
      await disconnecting.run(() => cb().storage.disconnect(id));
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /** The connected storage, as rows with a Disconnect button each. In the card (NUX), a border
   * separates it from the Add buttons below and an empty list says so; bare (Settings), there's
   * no such border (the page has its own dividers) and nothing shows for an empty list. */
  function connectionRows(bordered: boolean) {
    if (live.length === 0) {
      return bordered ? <p className="text-muted small mb-3">Nothing connected yet.</p> : null;
    }
    return (
      <div className={bordered ? 'border-bottom pb-3 mb-3' : 'mb-3'}>
        {live.map((c) => (
          <div key={c.id} className="settings-row">
            <span className="text-truncate">{c.label}</span>
            <button
              type="button"
              className="btn btn-sm btn-outline-danger px-2 flex-shrink-0"
              title={`Disconnect ${c.label}`}
              aria-label={`Disconnect ${c.label}`}
              disabled={disconnecting.busy}
              onClick={() => void disconnect(c.id)}
            >
              {disconnecting.busy && disconnectingId === c.id ? <Spinner /> : <TrashIcon />}
            </button>
          </div>
        ))}
      </div>
    );
  }

  const addButtons = (
    <div className="d-flex gap-2 flex-wrap">
      {!drive && (
        <button type="button" className="btn btn-outline-primary" onClick={startDrive}>
          + Add Google Drive
        </button>
      )}
      <button
        type="button"
        className="btn btn-outline-primary"
        onClick={() => setShowS3Modal(true)}
      >
        + Add S3 bucket
      </button>
    </div>
  );

  const modals = (
    <>
      {showDriveModal && (
        <ConnectDriveModal
          deviceCode={deviceCode}
          waiting={device.busy}
          onClose={() => setShowDriveModal(false)}
        />
      )}
      {showS3Modal && (
        <ConnectS3Modal onConnect={connectS3} onClose={() => setShowS3Modal(false)} />
      )}
    </>
  );

  if (bare) {
    return (
      <>
        {connectionRows(false)}
        {addButtons}
        {error && <div className="alert alert-danger py-2 small mt-2 mb-0">{error}</div>}
        {modals}
      </>
    );
  }

  return (
    <div className="col-12">
      <div className="card shadow-sm">
        <div className="card-body">
          <h3 className="card-title h5">Storage</h3>
          {connectionRows(true)}
          {addButtons}
          {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}
        </div>
      </div>
      {modals}
    </div>
  );
}
