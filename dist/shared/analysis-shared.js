/* SharedWorker: single shared analysis state across tabs (RT-5).
 *
 * The first tab that opens the app becomes the owner: it runs the heavy
 * processing and posts the compact results here. Any further tab connects
 * to this same worker and receives the already-computed index + ranking
 * instead of re-processing the 1.8 GB file. State lives in the worker, so
 * it survives navigation and is shared by all tabs of the origin.
 *
 * Why a SharedWorker and not BroadcastChannel/localStorage: only a
 * SharedWorker gives one live owner + shared in-memory state with
 * message ports to every tab.
 */

const ports = [];
let sharedState = null; // { status, progress, ranking, metrics, updatedAt }
let ownerPort = null;

function broadcast(msg, except = null) {
  for (const p of ports) {
    if (p === except) continue;
    try {
      p.postMessage(msg);
    } catch {
      /* tab went away */
    }
  }
}

function snapshotFor(tabId) {
  return { kind: 'snapshot', tabId, state: sharedState };
}

self.onconnect = (ev) => {
  const port = ev.ports[0];
  ports.push(port);
  port.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.kind === 'hello') {
      port.postMessage(snapshotFor(msg.tabId));
      broadcast({ kind: 'tabs', count: ports.length });
    } else if (msg.kind === 'claim-owner') {
      if (ownerPort === null) {
        ownerPort = port;
        port.postMessage({ kind: 'owner', granted: true });
      } else {
        port.postMessage({ kind: 'owner', granted: false });
      }
    } else if (msg.kind === 'publish') {
      // Only the owner may publish results.
      if (port === ownerPort) {
        sharedState = msg.state;
        broadcast({ kind: 'snapshot', state: sharedState }, port);
      }
    } else if (msg.kind === 'progress') {
      if (port === ownerPort && sharedState) {
        sharedState.progress = msg.progress;
        broadcast({ kind: 'snapshot', state: sharedState }, port);
      }
    } else if (msg.kind === 'release-owner') {
      if (port === ownerPort) {
        ownerPort = null;
        sharedState = null;
      }
    }
  };
  port.start();
};
