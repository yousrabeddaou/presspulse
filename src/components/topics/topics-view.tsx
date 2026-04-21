"use client";

import { useEffect, useMemo, useState } from "react";
import { Toast } from "@/components/ui/toast";

type Topic = {
  id: string;
  created_at: string;
  name: string;
  query: string;
  language: "en" | "fr" | "ar" | null;
  is_active: boolean;
  auto_discover?: boolean;
  last_discovered_at?: string | null;
  discover_interval_hours?: number;
  project_id?: string | null;
  articles_count?: number;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
};

const LANG_OPTIONS = [
  { value: "any", label: "Any language (FR + AR + EN)" },
  { value: "fr", label: "🇫🇷 Français only" },
  { value: "en", label: "🇬🇧 English only" },
  { value: "ar", label: "🇲🇦 عربي only" }
] as const;

export function TopicsView() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<"any" | "en" | "fr" | "ar">("any");
  const [autoDiscover, setAutoDiscover] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>("none");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Project creation
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const [discoveringId, setDiscoveringId] = useState<string | null>(null);

  const [toastOpen, setToastOpen] = useState(false);
  const [toastTitle, setToastTitle] = useState("");
  const [toastDesc, setToastDesc] = useState<string | undefined>();

  async function refresh() {
    const [tRes, pRes] = await Promise.all([
      fetch("/api/topics", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" })
    ]);

    if (!tRes.ok) {
      setError("Please sign in first to manage topics.");
      return;
    }
    const tData = (await tRes.json()) as { topics: Topic[] };
    setTopics(tData.topics ?? []);

    if (pRes.ok) {
      const pData = (await pRes.json()) as { projects: Project[] };
      setProjects(pData.projects ?? []);
    }
    setError(null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const visibleTopics = useMemo(
    () => topics.filter((t) => (showArchived ? true : t.is_active)),
    [topics, showArchived]
  );

  // Group visible topics by project
  const grouped = useMemo(() => {
    const byProject = new Map<string, Topic[]>();
    byProject.set("__unassigned__", []);
    for (const p of projects) byProject.set(p.id, []);
    for (const t of visibleTopics) {
      const key = t.project_id ?? "__unassigned__";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }
    return byProject;
  }, [visibleTopics, projects]);

  async function createProject() {
    if (!newProjectName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || null
      })
    });
    if (!res.ok) {
      setToastTitle("Could not create project");
      setToastOpen(true);
      return;
    }
    setNewProjectName("");
    setNewProjectDesc("");
    setShowProjectForm(false);
    setToastTitle("✨ Project created");
    setToastOpen(true);
    await refresh();
  }

  async function deleteProject(project: Project) {
    const confirmed = window.confirm(
      `Delete project "${project.name}"? Topics inside will be kept (unassigned). Articles are not deleted.`
    );
    if (!confirmed) return;
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (!res.ok) {
      setToastTitle("Could not delete project");
      setToastOpen(true);
      return;
    }
    await refresh();
  }

  async function runDiscover(topicId: string, topicName: string) {
    setDiscoveringId(topicId);
    setToastTitle("🔍 Discovering coverage...");
    setToastDesc(`Searching FR, AR & EN for "${topicName}". 30-90s.`);
    setToastOpen(true);

    try {
      const res = await fetch(`/api/topics/${topicId}/discover`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setToastTitle("Discovery failed");
        setToastDesc(data.error ?? "Check your API keys.");
        setToastOpen(true);
        return;
      }

      setToastTitle(`✅ Discovery complete for ${topicName}`);
      setToastDesc(
        `Found ${data.results_found ?? 0} results · ${data.articles_created ?? 0} new · ${data.articles_updated ?? 0} updated.`
      );
      setToastOpen(true);
      await refresh();
    } catch (err) {
      setToastTitle("Discovery failed");
      setToastDesc((err as Error).message);
      setToastOpen(true);
    } finally {
      setDiscoveringId(null);
    }
  }

  async function toggleArchive(topic: Topic) {
    const res = await fetch(`/api/topics/${topic.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !topic.is_active })
    });
    if (!res.ok) {
      setToastTitle("Could not update topic");
      setToastOpen(true);
      return;
    }
    await refresh();
  }

  async function deleteTopic(topic: Topic) {
    const confirmed = window.confirm(
      `Delete "${topic.name}" permanently? Articles stay but their tag to this topic is removed.`
    );
    if (!confirmed) return;
    const res = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
    if (!res.ok) {
      setToastTitle("Could not delete topic");
      setToastOpen(true);
      return;
    }
    await refresh();
  }

  async function moveToProject(topic: Topic, projectId: string | null) {
    const res = await fetch(`/api/topics/${topic.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    if (!res.ok) {
      setToastTitle("Could not move topic");
      setToastOpen(true);
      return;
    }
    await refresh();
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
        {error} Go to <a className="underline" href="/login">/login</a>.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        title={toastTitle}
        description={toastDesc}
      />

      <div>
        <div className="text-sm font-semibold">Projects & Topics</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Organize monitoring topics into projects. Each topic auto-searches FR, AR & EN and ranks coverage by domain authority.
        </div>
      </div>

      {/* Projects bar */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Projects
          </div>
          <button
            type="button"
            onClick={() => setShowProjectForm((v) => !v)}
            className="h-8 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8"
          >
            {showProjectForm ? "Cancel" : "+ New project"}
          </button>
        </div>
        {showProjectForm ? (
          <div className="mt-3 space-y-2">
            <input
              className="h-10 w-full rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20"
              placeholder="Project name (e.g., Luxury Hotels 2026)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <input
              className="h-10 w-full rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20"
              placeholder="Description (optional)"
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
            />
            <button
              className="h-9 rounded-xl bg-white/10 px-4 text-xs font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-60"
              disabled={!newProjectName.trim()}
              onClick={() => void createProject()}
            >
              Create project
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {projects.length ? (
              projects.map((p) => {
                const count = topics.filter((t) => t.project_id === p.id).length;
                return (
                  <div
                    key={p.id}
                    className="group flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs ring-1 ring-white/10"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{count}</span>
                    <button
                      onClick={() => void deleteProject(p)}
                      className="opacity-0 transition group-hover:opacity-100 text-red-400 hover:text-red-300"
                      title="Delete project"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-xs italic text-muted-foreground">
                No projects yet. Create one to group related topics.
              </div>
            )}
          </div>
        )}
      </div>

      {/* New topic form */}
      <div className="glass rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          New topic
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            className="h-11 rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20"
            placeholder="Topic name (e.g., SIAM 2026)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="h-11 rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20 md:col-span-2"
            placeholder='Query (space-separated, e.g., "SIAM 2026")'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10 outline-none"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10 outline-none"
            value={language}
            onChange={(e) => setLanguage(e.target.value as "any" | "en" | "fr" | "ar")}
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10">
            <input
              type="checkbox"
              checked={autoDiscover}
              onChange={(e) => setAutoDiscover(e.target.checked)}
              className="h-3.5 w-3.5 accent-white/60"
            />
            Auto-discover (every 6h)
          </label>

          <button
            className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-60"
            disabled={!name.trim() || !query.trim()}
            onClick={async () => {
              const res = await fetch("/api/topics", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  name: name.trim(),
                  query: query.trim(),
                  language: language === "any" ? null : language,
                  autoDiscover,
                  projectId: selectedProject === "none" ? null : selectedProject
                })
              });
              if (!res.ok) {
                setToastTitle("Could not create topic");
                setToastOpen(true);
                return;
              }
              const data = await res.json();
              setName("");
              setQuery("");
              await refresh();
              if (data.topic?.id) {
                await runDiscover(data.topic.id, data.topic.name);
              }
            }}
          >
            Create & discover
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {visibleTopics.length} topic{visibleTopics.length === 1 ? "" : "s"}
          {!showArchived && topics.some((t) => !t.is_active)
            ? ` · ${topics.filter((t) => !t.is_active).length} archived hidden`
            : ""}
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="h-8 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8"
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {/* Topics grouped by project */}
      <div className="space-y-5">
        {Array.from(grouped.entries()).map(([projectKey, projectTopics]) => {
          if (!projectTopics.length) return null;
          const project = projects.find((p) => p.id === projectKey);
          const label = project?.name ?? "Unassigned";

          return (
            <div key={projectKey}>
              <div className="mb-2 flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="text-xs text-muted-foreground">
                  ({projectTopics.length})
                </div>
              </div>
              <div className="space-y-2">
                {projectTopics.map((t) => {
                  const isDiscovering = discoveringId === t.id;
                  const lastRun = t.last_discovered_at
                    ? new Date(t.last_discovered_at).toLocaleString()
                    : "never";

                  return (
                    <div
                      key={t.id}
                      className={`glass rounded-2xl p-4 ring-1 ring-white/10 ${
                        !t.is_active ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold">{t.name}</div>
                            {(t.articles_count ?? 0) > 0 ? (
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-white/10">
                                {t.articles_count} article{t.articles_count === 1 ? "" : "s"}
                              </span>
                            ) : null}
                            {!t.is_active ? (
                              <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-zinc-500/20">
                                ARCHIVED
                              </span>
                            ) : t.auto_discover ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                                AUTO
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Query: <span className="text-foreground/90">{t.query}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Language: {t.language ?? "any"} · Last discovered: {lastRun}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                          {t.is_active ? (
                            <button
                              className="h-9 rounded-xl bg-white/10 px-3 text-xs font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-60"
                              disabled={isDiscovering}
                              onClick={() => void runDiscover(t.id, t.name)}
                            >
                              {isDiscovering ? "Discovering…" : "🔍 Discover"}
                            </button>
                          ) : null}
                          <a
                            className="h-9 rounded-xl bg-white/5 px-3 text-xs leading-9 ring-1 ring-white/10 transition hover:bg-white/8"
                            href={`/feed?topicId=${t.id}`}
                          >
                            View
                          </a>

                          <select
                            className="h-9 rounded-xl bg-white/5 px-2 text-xs ring-1 ring-white/10 outline-none"
                            value={t.project_id ?? "__none__"}
                            onChange={(e) =>
                              void moveToProject(
                                t,
                                e.target.value === "__none__" ? null : e.target.value
                              )
                            }
                          >
                            <option value="__none__">No project</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>

                          <button
                            className="h-9 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8"
                            onClick={() => void toggleArchive(t)}
                          >
                            {t.is_active ? "Archive" : "Restore"}
                          </button>
                          <button
                            className="h-9 rounded-xl bg-red-500/10 px-3 text-xs text-red-300 ring-1 ring-red-500/20 transition hover:bg-red-500/15"
                            onClick={() => void deleteTopic(t)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!visibleTopics.length ? (
          <div className="rounded-2xl bg-white/5 p-5 text-sm text-muted-foreground ring-1 ring-white/10">
            {topics.length && !showArchived
              ? 'All topics are archived. Click "Show archived" to see them.'
              : 'No topics yet. Create one like "SIAM 2026" above.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
