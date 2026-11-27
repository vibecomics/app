import { useState } from 'react';
import type { ReactNode } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { writeGeneratorConfig } from '../generators/browserConfigStore';
import type { GeneratorConfig } from '../generators/types';
import type { ProjectFolder } from '../storage/types';
import ConnectSettings from './ConnectSettings';
import { BackArrowIcon, PencilIcon, RefreshIcon } from './Icons';
import IconButton from './IconButton';
import Spinner from './Spinner';
import { clearDismissedHelp } from './useDismissedHelp';
import { useGeneratorConfig } from './useGeneratorConfig';
import { useStorageConnections } from './useStorageConnections';
import { useTask } from './useTask';

/** One field of the image service config, shown as its value (click it, or Edit, to edit) with
 * Save/Cancel while editing. */
function EditableConfigField({
  label,
  value,
  placeholder,
  multiline,
  extraActions,
  onSave,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  multiline?: boolean;
  extraActions?: ReactNode;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(value ?? '');
    setEditing(true);
  }

  function save() {
    onSave(draft.trim());
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mb-3">
        <label className="form-label small">{label}</label>
        {multiline ? (
          <>
            <textarea
              className="form-control form-control-sm mb-2"
              rows={4}
              autoFocus
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={save}>
                Save
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={cancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="d-flex gap-2">
            <input
              className="form-control form-control-sm"
              autoFocus
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <button type="button" className="btn btn-primary btn-sm flex-shrink-0" onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm flex-shrink-0"
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3">
      <label className="form-label small">{label}</label>
      <div className="d-flex gap-2 align-items-center">
        <span
          role="button"
          tabIndex={0}
          className={`flex-grow-1 text-truncate${value ? '' : ' text-muted'}`}
          style={{ cursor: 'pointer' }}
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') startEdit();
          }}
        >
          {value || 'None set'}
        </span>
        <div className="d-flex gap-2 flex-shrink-0">
          {extraActions}
          <IconButton label={`Edit ${label}`} title={`Edit ${label}`} onClick={startEdit}>
            <PencilIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** The image service: a URL this app POSTs generation requests to, instructions for an LLM agent
 * on how to generate images itself, or both — the same config an LLM reads and writes through
 * generate.config. Each field edits and saves independently. */
function ImageServiceSettings() {
  const config = useGeneratorConfig();
  const testTask = useTask();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [configError, setConfigError] = useState('');

  function updateConfig(patch: { url?: string; prompt?: string }) {
    const url = 'url' in patch ? patch.url : config?.url;
    const prompt = 'prompt' in patch ? patch.prompt : config?.prompt;
    if (!url && !prompt) {
      // Neither field is set: there's nothing left to configure, and a service config needs
      // at least one (assertValidGeneratorConfig) — so clear it instead of saving an empty one.
      writeGeneratorConfig(null);
      setConfigError('');
      setTestResult(null);
      return;
    }
    const next: GeneratorConfig = {
      provider: 'service',
      ...(url && { url }),
      ...(prompt && { prompt }),
    };
    const result = cb().generate.config(next);
    if (!result.ok) {
      setConfigError(result.error ?? 'Could not save.');
      return;
    }
    setConfigError('');
    setTestResult(null);
  }

  function testConnection() {
    setTestResult(null);
    void testTask.run(async () => {
      const result = await cb().generate.test();
      setTestResult(
        result.ok
          ? { ok: true, message: 'Connected — the image service responded.' }
          : { ok: false, message: result.error ?? 'Connection failed.' }
      );
    });
  }

  return (
    <>
      <EditableConfigField
        label="Service URL"
        value={config?.url}
        placeholder="http://127.0.0.1:8188/vibecomic/generate"
        onSave={(url) => updateConfig({ url })}
        extraActions={
          config?.url && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={testTask.busy}
              onClick={testConnection}
            >
              {testTask.busy && <Spinner />}
              Test
            </button>
          )
        }
      />
      {testResult && (
        <div
          className={`alert ${testResult.ok ? 'alert-success' : 'alert-danger'} alert-dismissible d-flex align-items-center justify-content-between gap-2 py-2 small mb-3`}
          role="alert"
        >
          <span>{testResult.message}</span>
          <button
            type="button"
            className="btn-close flex-shrink-0"
            style={{ fontSize: '0.65rem' }}
            aria-label="Dismiss"
            onClick={() => setTestResult(null)}
          />
        </div>
      )}
      <EditableConfigField
        label="Instructions for an AI agent"
        value={config?.prompt}
        placeholder="e.g. Generate images with the ComfyUI server at http://…:8188/vibecomic/generate."
        multiline
        onSave={(prompt) => updateConfig({ prompt })}
      />
      {configError && <div className="text-danger small mb-2">{configError}</div>}
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
      <div className="container py-5" style={{ maxWidth: 760 }}>
        <div className="d-flex align-items-center gap-3 mb-5">
          <IconButton label="Back" title="Back" onClick={() => window.history.back()}>
            <BackArrowIcon />
          </IconButton>
          <h1 className="h3 mb-0">Settings</h1>
        </div>

        <section className="mb-4">
          <h2 className="h5 mb-1">Storage</h2>
          <p className="text-muted small mb-2">
            Where your comics are kept: Google Drive, or an S3-compatible bucket.
          </p>
          <ConnectSettings
            connections={connections}
            deviceCode={deviceCode}
            onChange={refreshConnections}
            bare
          />
        </section>

        <section className="mb-4 border-top pt-4">
          <h2 className="h5 mb-1">Image service</h2>
          <p className="text-muted small mb-2">
            Where image-generation requests are sent while the comic is built.
          </p>
          <ImageServiceSettings />
        </section>

        <div className="border-top pt-4">
          <div className="settings-row">
            <span>Closed help text</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-2 flex-shrink-0"
              onClick={() => clearDismissedHelp()}
            >
              <RefreshIcon />
              Show again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
