import { useEffect, useState } from "react";
import {
  Bot,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  PlugZap,
  Database,
  HardDrive,
  Palette,
} from "lucide-react";
import {
  getSettings,
  saveSettings,
  testConnection,
  listModels,
  type ConnectionTestResult,
} from "../lib/api";
import { cn } from "../lib/utils";
import ThemeToggle from "./ThemeToggle";
import ServerStatus from "./ServerStatus";

// Fallback suggestions if the dynamic /models fetch fails (kept in sync with
// the known Z.AI ids, but the form prefers the live list from the API).
const MODEL_FALLBACKS = ["glm-4.5-air", "glm-4.5", "glm-4.6", "glm-4.7", "glm-5", "glm-5.1", "glm-5.2"];

export default function ProviderSettings() {
  const [provider] = useState("Z.AI");
  const [model, setModel] = useState("glm-4.5-air");
  const [baseUrl, setBaseUrl] = useState("https://api.z.ai/api/coding/paas/v4/");
  const [apiKey, setApiKey] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(MODEL_FALLBACKS);

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setModel(s.model);
        setBaseUrl(s.base_url);
        setKeyHint(s.api_key_hint);
        setKeySet(s.api_key_set);
        setLoading(false);
        // If a key is already saved server-side, fetch the live model list.
        if (s.api_key_set) {
          listModels("", s.base_url).then((m) => m.length && setModelOptions(m));
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Gagal memuat pengaturan");
        setLoading(false);
      });
  }, []);

  // Fetch live model list whenever the user enters/edits a key (debounced blur).
  const refreshModels = (key: string) => {
    if (!key) return;
    listModels(key, baseUrl)
      .then((m) => {
        if (m.length) setModelOptions(m);
      })
      .catch(() => {});
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const r = await testConnection({ api_key: apiKey, model, base_url: baseUrl });
      setTestResult(r);
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : "Test gagal",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings({ provider, model, api_key: apiKey, base_url: baseUrl });
      setSavedAt(Date.now());
      setApiKey("");
      // refresh hint
      getSettings()
        .then((s) => {
          setKeyHint(s.api_key_hint);
          setKeySet(s.api_key_set);
        })
        .catch(() => {});
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Memuat pengaturan…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* LLM Provider */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">LLM Provider</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Provider
            </label>
            <input
              value={provider}
              readOnly
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Model
            </label>
            <input
              list="model-suggestions"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="cth: glm/glm-4.5-air"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <datalist id="model-suggestions">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              API Key
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={(e) => refreshModels(e.target.value)}
                placeholder={keySet ? `Tersimpan (${keyHint}) — ketik untuk ganti` : "Masukkan Z.AI API key"}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Disimpan di <code className="px-1 bg-muted rounded">data/settings.json</code> (server).
              Kosongkan untuk mempertahankan key yang ada.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Base URL
            </label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Test + Save */}
        <div className="flex flex-wrap items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PlugZap className="w-4 h-4" />
            )}
            Test Connection
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Simpan
          </button>

          {savedAt && (
            <span className="inline-flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              Tersimpan
            </span>
          )}
        </div>

        {testResult && (
          <div
            className={cn(
              "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              testResult.ok
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-medium">
                {testResult.ok ? "Terhubung" : "Gagal terhubung"}
              </div>
              {testResult.ok && testResult.reply && (
                <div className="text-xs opacity-80 truncate">Balasan: “{testResult.reply}”</div>
              )}
              {!testResult.ok && testResult.error && (
                <div className="text-xs opacity-80 break-all">{testResult.error}</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Preferences — theme */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Preferensi</h2>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Tema tampilan</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Light / Dark / mengikuti sistem.
            </div>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Server status */}
      <ServerStatus />

      {/* Data paths (read-only info) */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Data</h2>
        </div>
        <div className="space-y-2 text-sm">
          <DataRow
            icon={HardDrive}
            label="ChromaDB"
            path="data/chroma_db/"
            hint="vektor index"
          />
          <DataRow
            icon={HardDrive}
            label="Raw data"
            path="data/raw/<area>/"
            hint="JSONL hasil scrape"
          />
          <DataRow
            icon={HardDrive}
            label="Cleaned data"
            path="data/cleaned/"
            hint="dokumen RAG"
          />
        </div>
      </section>
    </div>
  );
}

function DataRow({
  icon: Icon,
  label,
  path,
  hint,
}: {
  icon: typeof HardDrive;
  label: string;
  path: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-xs text-muted-foreground font-mono truncate">{path}</div>
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">{hint}</span>
    </div>
  );
}
