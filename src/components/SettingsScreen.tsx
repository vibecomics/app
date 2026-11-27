import { useState } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { ProjectFolder } from '../storage/types';
import ConnectSettings from './ConnectSettings';
import GeneratorSettings from './GeneratorSettings';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';
import { useStorageConnections } from './useStorageConnections';

/** A one-line summary of the image generator and a button to configure it. */
function GeneratorSettingsCard() {
  const [editing, setEditing] = useState(false);
  const config = useGeneratorConfig();
  const problem = useGeneratorConfigProblem();
  const summary = config ? (config.url ?? 'Agent instructions only') : (problem ?? 'Not set up');

  return (
    <div className="col-12 col-sm-6 col-md-4">
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column">
          <h3 className="card-title h6">Image service</h3>
          <p className={`small text-truncate${config ? '' : ' text-muted'}`} title={summary}>
            {summary}
          </p>
          <button
            className="btn btn-outline-secondary mt-auto align-self-start"
            onClick={() => setEditing(true)}
          >
            {config ? 'Edit' : 'Set up'}
          </button>
        </div>
      </div>
      {editing && <GeneratorSettings onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * The settings page, at #settings: storage and the image generator, rarely changed once a comic
 * exists. Reached from the NUX and project list pages, and from the editor's hamburger menu.
 */
export default function SettingsScreen({
  projects,
  deviceCode,
}: {
  projects: ProjectFolder[];
  deviceCode: DeviceCodeInfo | null;
}) {
  const { connections, refreshConnections } = useStorageConnections(projects, deviceCode);

  return (
    <div className="min-vh-100 bg-body-tertiary">
      <div className="container py-5" style={{ maxWidth: 720 }}>
        <div className="d-flex align-items-center gap-3 mb-4">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => window.history.back()}
          >
            ← Back
          </button>
          <h1 className="h4 mb-0">Settings</h1>
        </div>
        <div className="row g-3">
          <ConnectSettings
            connections={connections}
            deviceCode={deviceCode}
            onChange={refreshConnections}
          />
          <GeneratorSettingsCard />
        </div>
      </div>
    </div>
  );
}
