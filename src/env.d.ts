declare namespace Cloudflare {
  interface Env {
    STATUS: DurableObjectNamespace<import("./status-do").StatusDO>;
    EDITOR_TOKEN: string;
    HOOK_TOKEN: string;
  }
}
interface Env extends Cloudflare.Env {}
