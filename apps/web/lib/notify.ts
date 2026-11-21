// Browser notifications (demo alerts, docs/10 demo deltas). Permission is requested only from a user
// action (settings toggle, enabling browser alerts on a rule), never on page load.
const KEY = "me:v1:browser_notify";

export type NotifyState = "unsupported" | "default" | "granted" | "denied";

export const notifyState = (): NotifyState =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/** User switch in settings (default on); the browser permission is separate. */
export function browserAlertsOn(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function setBrowserAlerts(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
}

/** Call from a click handler only. */
export async function askPermission(): Promise<NotifyState> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") await Notification.requestPermission();
  return Notification.permission;
}

export function showNotification(title: string, body: string, onClick?: () => void) {
  if (notifyState() !== "granted" || !browserAlertsOn()) return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico" });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}
