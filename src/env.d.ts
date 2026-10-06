declare namespace Cloudflare {
  interface Env {
    STATUS: DurableObjectNamespace<import("./status-do").StatusDO>;
    HOOK_TOKEN: string;
    /** Comma-separated origins allowed via CORS, e.g. "https://user.github.io". */
    ALLOWED_ORIGINS?: string;
  }
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "StatusDO";
  }
}
interface Env extends Cloudflare.Env {}
