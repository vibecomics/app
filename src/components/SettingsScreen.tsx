import { useState } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { ProjectFolder } from '../storage/types';
import ConnectSettings from './ConnectSettings';
import GeneratorSettings from './GeneratorSettings';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';
import { useStorageConnections } from './useStorageConnections';

function ImageServiceSettings() {
  const [editing, setEditing] = useState(false);
  const config = useGeneratorConfig();
  const problem = useGeneratorConfigProblem();
  const summary = config ? (config.url ?? 'Agent instructions only') : (problem ?? 'Not set up');

  return (
    <>
      <div className="d-flex align-items-center justify-content-between gap-3">
        <p className={`mb-0 text-truncate${config ? '' : ' text-muted'}`} title={summary}>
          {summary}
        </p>
        <button
          type="button"
          className="btn btn-outline-secondary flex-shrink-0"
          onClick={() => setEditing(true)}
        >
          {config ? 'Edit' : 'Set up'}
        </button>
      </div>
      {editing && <GeneratorSettings onClose={() => setEditing(false)} />}
    </>
  );
}

/** The settings page, at #settings: storage and the image generator. */
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
        <div className="d-flex align-items-center gap-3 mb-5">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => window.history.back()}
          >
            ← Back
          </button>
          <h1 className="h4 mb-0">Settings</h1>
        </div>

        <section className="mb-5">
          <h2 className="h5 mb-1">Storage</h2>
          <p className="text-muted small mb-3">
            VibeComics does not store anything on its own servers. Your comics stay in the storage
            you connect here.
          </p>
          <ConnectSettings
            connections={connections}
            deviceCode={deviceCode}
            onChange={refreshConnections}
            bare
          />
        </section>

        <section className="border-top pt-5">
          <h2 className="h5 mb-1">Image service</h2>
          <p className="text-muted small mb-3">
            Where the AI agent sends image-generation requests while it builds the comic.
          </p>
          <ImageServiceSettings />
        </section>
      </div>
    </div>
  );
}
