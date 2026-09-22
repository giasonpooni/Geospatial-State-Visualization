/**
 * Entry point: boot the geographic state client, mount the instrument HUD, expose the
 * structured tool surface for future agent bindings.
 */

import './ui/theme.css';
import './ui/inspect.css';
import { App } from './app/app';
import { buildToolSurface } from './app/toolSurface';
import { createCommandBar } from './ui/commandBar';
import { createLayerPanel } from './ui/layerPanel';
import { createStatusBar } from './ui/statusBar';
import { createToasts } from './ui/toasts';
import { createInfoPanel } from './ui/infoPanel';
import { createTimeline } from './ui/timeline';
import { CiwReadClient } from './app/ciwClient';
import { WorkbenchProvider } from './data/workbench/provider';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;

  const app = new App();
  const parameters = new URLSearchParams(window.location.search);
  let provider: WorkbenchProvider | undefined;
  let client: CiwReadClient | undefined;
  try {
    if (parameters.has('ciw') || parameters.has('source')) {
      const status = document.createElement('div');
      status.className = 'pe-ciw-status';
      status.textContent = 'CONNECTING TO CIW';
      hud.appendChild(status);
      client = new CiwReadClient(parameters.get('ciw') ?? '', (message) => { status.textContent = message; });
      provider = new WorkbenchProvider(() => client!.inspect(parameters.get('source') ?? ''));
      await app.boot(canvas, hud, provider);
      const detail = document.createElement('details');
      detail.className = 'pe-ciw-evidence';
      const title = document.createElement('summary');
      title.textContent = 'WORKBENCH EVIDENCE · FRAME · TIME';
      const evidence = document.createElement('pre');
      const { bytes_b64, ...descriptor } = provider.view.source;
      evidence.textContent = JSON.stringify({ source: descriptor, frame: provider.view.coordinate_frame,
        timeRange: app.store.snapshot.timeRange, state_policy: provider.view.state_policy,
        authority: provider.view.authority }, null, 2);
      detail.append(title, evidence); hud.appendChild(detail);
      window.addEventListener('pagehide', () => client?.close(), { once: true });
    } else await app.boot(canvas, hud);
  } catch (err) {
    client?.close();
    const status = document.getElementById('boot-status');
    if (status) status.textContent = `BOOT FAILED — ${String(err)}`;
    throw err;
  }

  // instrument layer
  hud.appendChild(createCommandBar(app).el);
  hud.appendChild(createLayerPanel(app).el);
  hud.appendChild(createStatusBar(app).el);
  hud.appendChild(createToasts(app).el);
  hud.appendChild(createInfoPanel(app).el);
  hud.appendChild(createTimeline(app).el);

  // escape: exit demo, else clear selection — but never while typing
  // (the search box owns Escape for its own dropdown/blur)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (app.isDemoActive()) app.stopFollowTheLoad();
    else {
      app.select(null);
      app.selectCountry(null);
    }
  });

  // structured tool surface (GeoAgent pattern): the same operations the
  // command bar uses, exposed for a future agent/MCP binding.
  const tools = buildToolSurface(app);
  (window as unknown as Record<string, unknown>).payloadEarth = {
    api: app,
    tools,
    workbenchView: provider?.view ?? null,
    invokeTool: (name: string, args: Record<string, unknown> = {}) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      return tool.invoke(args);
    },
  };

  app.events.emit('toast', {
    title: 'GEOSPATIAL STATE VISUALIZATION ONLINE',
    body: `${app.store.snapshot.meta.label} · ${app.store.snapshot.meta.disclaimer}`,
    tone: 'info',
  });
}

void start();
