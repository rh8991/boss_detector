declare namespace Cloudflare {
  interface Env {
    STATUS: DurableObjectNamespace<import("./status-do").StatusDO>;
    EDITOR_TOKEN: string;
    HOOK_TOKEN: string;
  }
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "StatusDO";
  }
}
interface Env extends Cloudflare.Env {}
