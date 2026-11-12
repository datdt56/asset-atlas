import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Layers3,
  Upload,
  ArrowUpRight,
  ChevronDown,
  Download,
  Search,
  SlidersHorizontal,
  Check,
  ShieldCheck,
  FileSpreadsheet,
  X,
  Monitor,
  Laptop,
  Server,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import {
  extract,
  fields,
  mapHeaders,
  readWorkbook,
  toCSV,
  type Asset,
  type Sheet,
  type Field,
} from "./extract";
import {
  resolveHeaders,
  decisionsToMapping,
  checkConflicts,
  applyEmbeddingResults,
  type HeaderDecision,
} from "./mapping/resolve";
import { matchCloud } from "./mapping/cloud";
import "./style.css";
const labels: Record<Field, string> = {
  type: "Asset type",
  manufacturer: "Manufacturer",
  model: "Model",
  serial: "Serial number",
  cpu: "CPU",
  ram: "RAM",
  storage: "Storage",
  screen: "Screen size",
};
function App() {
  const [sheets, setSheets] = useState<Sheet[]>([]),
    [filename, setFilename] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("All assets"),
    [mapping, setMapping] = useState(false),
    [selected, setSelected] = useState<Asset | null>(null),
    [edits, setEdits] = useState<Record<string, Partial<Asset>>>({}),
    [drag, setDrag] = useState(false),
    [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [cloudMessages, setCloudMessages] = useState<Record<string, string>>(
    {},
  );
  const [cloudRetry, setCloudRetry] = useState(0);
  const importGeneration = useRef(0);
  const attempted = useRef(new Set<string>());
  const pendingSignature = JSON.stringify(
    sheets.map((sheet) => ({
      name: sheet.name,
      header: sheet.header,
      enabled: sheet.enabled,
      confirmed: sheet.headerConfirmed,
      pending: sheet.decisions
        ?.filter(
          (d) =>
            d.status === "unresolved" &&
            d.method !== "manual" &&
            d.normalized.replace(/\s/g, "").length > 3 &&
            d.original.length <= 160,
        )
        .map((d) => [d.columnIndex, d.original]),
    })),
  );
  useEffect(() => {
    const controller = new AbortController();
    const generation = importGeneration.current;
    const snapshot = JSON.parse(pendingSignature) as {
      name: string;
      header: number;
      enabled: boolean;
      confirmed: boolean;
      pending: [number, string][];
    }[];
    const run = async () => {
      // Process sheets sequentially to keep request volume small.
      for (const sheet of snapshot) {
        if (controller.signal.aborted) return;
        if (!sheet.enabled || !sheet.confirmed || !sheet.pending?.length)
          continue;
        const requestKey = JSON.stringify([generation, sheet, cloudRetry]);
        if (attempted.current.has(requestKey)) continue;
        attempted.current.add(requestKey);
        setCloudMessages((old) => ({
          ...old,
          [sheet.name]: "Checking unresolved headers with OpenAI…",
        }));
        try {
          const updates: HeaderDecision[] = [];
          for (let offset = 0; offset < sheet.pending.length; offset += 100) {
            const batch = sheet.pending.slice(offset, offset + 100);
            const results = await matchCloud(
              batch.map(([, h]) => h),
              controller.signal,
            );
            updates.push(
              ...results.map((d, i) => ({ ...d, columnIndex: batch[i][0] })),
            );
          }
          if (
            controller.signal.aborted ||
            generation !== importGeneration.current
          )
            return;
          setSheets((current) =>
            current.map((s) => {
              if (s.name !== sheet.name || s.header !== sheet.header) return s;
              const decisions = applyEmbeddingResults(
                s.decisions || [],
                updates,
              );
              return {
                ...s,
                decisions,
                mapping: decisionsToMapping(decisions),
              };
            }),
          );
          setCloudMessages((old) => ({
            ...old,
            [sheet.name]:
              "Cloud matching complete. Review semantic suggestions and any unresolved columns.",
          }));
        } catch (error) {
          if (controller.signal.aborted) {
            attempted.current.delete(requestKey);
            return;
          }
          setCloudMessages((old) => ({
            ...old,
            [sheet.name]:
              error instanceof Error
                ? error.message
                : "Cloud matching failed. Map manually.",
          }));
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [pendingSignature, cloudRetry]);
  const unresolvedCount = sheets
    .filter((s) => s.enabled)
    .reduce(
      (n, s) =>
        n + (s.decisions?.filter((d) => d.status === "unresolved").length || 0),
      0,
    );

  const assets = useMemo(
    () => extract(sheets).map((a) => ({ ...a, ...edits[a.id] })),
    [sheets, edits],
  );
  const review = assets.filter((a) => a.warnings.length);
  const visible = assets.filter(
    (a) =>
      (tab !== "Needs review" || a.warnings.length) &&
      (tab !== "Computers" || !["Monitor", "Peripheral"].includes(a.type)) &&
      Object.values(a).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  async function load(file: File) {
    setError("");
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setError("Please choose an .xlsx or .csv spreadsheet.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("File exceeds 15 MB. Split it into smaller workbooks.");
      return;
    }
    setBusy(true);
    try {
      const data = readWorkbook(await file.arrayBuffer());
      if (!data.some((s) => s.rows.length))
        throw Error("The file contains no readable rows.");
      importGeneration.current++;
      attempted.current.clear();
      setCloudMessages({});
      setSheets(data);
      setFilename(file.name);
      setEdits({});
      setTab("All assets");
      setMapping(
        data.some(
          (s) =>
            !s.headerConfirmed ||
            s.decisions?.some((d) => d.status === "unresolved"),
        ),
      );
      setSelected(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to read this file. Check that it is a valid spreadsheet.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    try {
      const r = await fetch("/sample_assets_1.xlsx");
      if (!r.ok) throw Error();
      await load(new File([await r.blob()], "sample_assets_1.xlsx"));
    } catch {
      setError("Could not load the sample. Please upload a file.");
    }
  }
  function download(format: "csv" | "json") {
    if (
      unresolvedCount &&
      !window.confirm(
        `${unresolvedCount} unresolved columns will be omitted. Export partial results?`,
      )
    )
      return;
    const blob = new Blob(
      [format === "csv" ? toCSV(visible) : JSON.stringify(visible, null, 2)],
      {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asset-atlas.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMenu(false);
  }
  const patch = (index: number, value: Partial<Sheet>) => {
    if (
      Object.keys(edits).length &&
      !window.confirm(
        "Changing column mapping resets your asset edits. Continue?",
      )
    )
      return;
    setSheets((s) => s.map((v, i) => (i === index ? { ...v, ...value } : v)));
    setEdits({});
    setSelected(null);
  };
  const manualMap = (
    sheetIndex: number,
    columnIndex: number,
    value: string,
  ) => {
    const sheet = sheets[sheetIndex];
    const decisions = (
      sheet.decisions || resolveHeaders(sheet.rows[sheet.header] || [])
    ).map((d) =>
      d.columnIndex !== columnIndex
        ? d
        : {
            ...d,
            status:
              value === "ignore"
                ? ("ignored" as const)
                : value === "unresolved"
                  ? ("unresolved" as const)
                  : ("accepted" as const),
            field:
              value === "ignore" || value === "unresolved"
                ? null
                : (value as Field | "description"),
            method: "manual" as const,
            reason: "Selected by you.",
          },
    );
    const checked = checkConflicts(decisions);
    patch(sheetIndex, {
      decisions: checked,
      mapping: decisionsToMapping(checked),
    });
  };
  return (
    <div className="app">
      <aside>
        <a className="brand" href="/">
          <span className="logo">
            <Layers3 size={22} />
          </span>
          asset<span className="brand-light">atlas</span>
          <span className="beta">BETA</span>
        </a>
        <div className="workspace">
          <span className="avatar">W</span>
          <div>
            My workspace<small>Personal workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <button className="nav active">
          <Layers3 size={18} /> Asset inventory <span className="nav-dot" />
        </button>
        <div className="aside-bottom">
          <div className="privacy">
            <ShieldCheck size={20} />
            <strong>Asset rows stay local</strong>
            <p>
              Asset rows stay in your browser. Unresolved header names are sent
              to OpenAI for optional cloud matching.
            </p>
          </div>
          <div className="profile">
            <span className="avatar profile-avatar">YO</span>
            <div>
              Your workspace<small>Local session</small>
            </div>
            <span className="online" />
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span> <b>Asset inventory</b>
          </span>
          <span className="local">
            <span /> Local extraction · Cloud header matching
          </span>
        </header>
        <div className="content">
          <div className="eyebrow">A LITTLE ORDER. A LOT OF CLARITY.</div>
          <div className="page-title">
            <div>
              <h1>
                Inventory, untangled<span>.</span>
              </h1>
              <p>Messy spreadsheets in. A clear picture of your fleet out.</p>
            </div>
            <span className="version">
              THE ASSET WORKBENCH <ArrowUpRight size={15} />
            </span>
          </div>
          <section
            className={`upload ${drag ? "drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files[0]) void load(e.dataTransfer.files[0]);
            }}
          >
            <div className="upload-icon">
              <Upload size={25} />
            </div>
            <div className="upload-copy">
              <h2>
                {busy
                  ? "Reading your spreadsheet…"
                  : "Every spreadsheet has a story. Drop yours here."}
              </h2>
              <p>Any layout. Any column order. We’ll find the assets.</p>
              <div className="file-types">
                <span>XLSX</span>
                <span>CSV</span>
                <i /> Up to 15 MB · Multiple sheets welcome
              </div>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={16} /> Upload spreadsheet
            </button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) void load(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </section>
          {error && (
            <div role="alert" className="error">
              <AlertCircle size={18} />
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="sample-line">
            <span>Just exploring?</span>{" "}
            <button onClick={demo} disabled={busy}>
              Try a sample spreadsheet <ArrowRight size={14} />
            </button>
            <span className="sample-note">
              A real-world mess, already included.
            </span>
          </div>
          <div className="section-title">
            <h2>Your fleet at a glance</h2>
            <span>
              {filename ? "LIVE OVERVIEW" : "READY WHEN YOU ARE"}{" "}
              <span className="tiny-dot" />
            </span>
          </div>
          <section className="stats">
            {[
              {
                label: "Total assets",
                value: assets.length,
                icon: Layers3,
                note: filename
                  ? `${sheets.filter((s) => s.enabled).length} sheets included`
                  : "Across your spreadsheets",
              },
              {
                label: "Laptops",
                value: assets.filter((a) => a.type === "Laptop").length,
                icon: Laptop,
                note: "Ready for wherever work happens",
              },
              {
                label: "Desktops & servers",
                value: assets.filter((a) =>
                  ["Desktop", "Server", "Workstation", "NAS"].includes(a.type),
                ).length,
                icon: Server,
                note: "The backbone of your fleet",
              },
              {
                label: "Needs review",
                value: review.length,
                icon: AlertCircle,
                note: "A second look goes a long way",
              },
            ].map((s, i) => (
              <div className={`stat stat-${i}`} key={s.label}>
                <div>
                  {s.label}
                  <s.icon size={18} />
                </div>
                <strong>{filename ? s.value : "—"}</strong>
                <p>{s.note}</p>
              </div>
            ))}
          </section>
          <section className="inventory">
            <div className="inventory-heading">
              <div>
                <h2>
                  Asset inventory <span>{assets.length}</span>
                </h2>
                <p>
                  {filename ? (
                    <>
                      <FileSpreadsheet size={13} /> {filename} <span>·</span>{" "}
                      Click an asset to inspect and edit
                    </>
                  ) : (
                    "Your next clean inventory starts here."
                  )}
                </p>
              </div>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!sheets.length}
                  onClick={() => setMapping(!mapping)}
                >
                  <SlidersHorizontal size={15} /> Column mapping
                </button>
                <div className="export-wrap">
                  <button
                    className="secondary"
                    disabled={!visible.length}
                    onClick={() => setMenu(!menu)}
                  >
                    <Download size={15} /> Export <ChevronDown size={13} />
                  </button>
                  {menu && (
                    <div className="export-menu">
                      <button onClick={() => download("csv")}>
                        Download CSV
                      </button>
                      <button onClick={() => download("json")}>
                        Download JSON
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {sheets.length > 0 && (
              <div className="mapping-notice" role="status">
                {unresolvedCount > 0
                  ? `${unresolvedCount} columns need a mapping or an explicit Ignore choice. Preview and exports omit unresolved columns.`
                  : "All included columns are mapped or explicitly ignored."}
                {sheets.some((s) => s.enabled && !s.headerConfirmed) &&
                  " Header row uncertain: select or confirm it in Column mapping."}
                <button className="secondary" onClick={() => setMapping(true)}>
                  Review mapping
                </button>
              </div>
            )}
            {mapping && (
              <div className="mapping">
                <h3>Make the mapping yours</h3>
                <p>
                  Choose a header row, include sheets, and tell us what each
                  column contains. Results update immediately. Scores measure
                  similarity, not confidence. Multiple description/storage
                  columns are joined with /; duplicate assignments to other
                  fields require manual resolution.
                </p>
                {sheets.map((s, i) => (
                  <div className="sheet-map" key={s.name}>
                    <div className="sheet-options">
                      <label>
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) =>
                            patch(i, { enabled: e.target.checked })
                          }
                        />
                        {s.name}
                      </label>
                      <label>
                        Header row{" "}
                        <select
                          value={s.header}
                          onChange={(e) =>
                            patch(i, {
                              header: +e.target.value,
                              mapping: mapHeaders(s.rows[+e.target.value]),
                              decisions: resolveHeaders(
                                s.rows[+e.target.value],
                              ),
                              headerConfirmed: true,
                            })
                          }
                        >
                          {s.rows.slice(0, 50).map((r, j) => (
                            <option key={j} value={j}>
                              {j + 1} · {r.slice(0, 3).join(" / ").slice(0, 75)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {!s.headerConfirmed && (
                      <button
                        className="secondary"
                        onClick={() => patch(i, { headerConfirmed: true })}
                      >
                        Use row {s.header + 1} as headers
                      </button>
                    )}
                    <p role="status">
                      {cloudMessages[s.name] ||
                        "Exact aliases and conservative fuzzy matching applied."}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        attempted.current.clear();
                        setCloudRetry((n) => n + 1);
                      }}
                    >
                      Retry cloud matching
                    </button>
                    <div className="map-fields">
                      {(s.rows[s.header] || []).map((h, j) => (
                        <label key={j}>
                          {h || `Column ${j + 1}`}
                          <select
                            value={
                              s.decisions?.[j]?.status === "ignored"
                                ? "ignore"
                                : s.decisions?.[j]?.status === "accepted"
                                  ? s.decisions[j].field || "unresolved"
                                  : "unresolved"
                            }
                            onChange={(e) => manualMap(i, j, e.target.value)}
                          >
                            <option value="unresolved">Needs mapping</option>
                            <option value="ignore">Ignore</option>
                            <option value="description">
                              Combined description
                            </option>
                            {fields.map((f) => (
                              <option key={f} value={f}>
                                {labels[f]}
                              </option>
                            ))}
                          </select>
                          <small className="mapping-reason">
                            {s.decisions?.[j]?.reason}
                          </small>
                          <small>
                            {s.decisions?.[j]?.method
                              ? `Method: ${s.decisions[j].method}`
                              : "Unresolved"}
                          </small>
                          {s.decisions?.[j]?.candidates.map((c) => (
                            <small key={c.field}>
                              {c.field}: {c.score.toFixed(3)} ({c.method})
                            </small>
                          ))}
                          <small className="source-example">
                            Example:{" "}
                            {s.rows
                              .slice(s.header + 1, s.header + 4)
                              .map((r) => r[j])
                              .filter(Boolean)
                              .join(" · ")
                              .slice(0, 140) || "No source values"}
                          </small>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="toolbar">
              <div className="tabs">
                {["All assets", "Computers", "Needs review"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "chosen" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "Needs review" && review.length > 0 && (
                      <span>{review.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  placeholder="Search your assets…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌕</kbd>
              </label>
            </div>
            {!filename ? (
              <div className="empty">
                <div className="empty-art">
                  <span />
                  <FileSpreadsheet size={38} />
                  <span className="check-circle">
                    <Check size={13} />
                  </span>
                </div>
                <h3>A fresh start for your asset data</h3>
                <p>
                  Upload a spreadsheet and we’ll turn scattered specs
                  <br />
                  into a structured, searchable inventory.
                </p>
                <button onClick={demo}>
                  Explore with sample data <ArrowRight size={15} />
                </button>
                <div className="empty-features">
                  <span>
                    <Check size={13} /> Smart column detection
                  </span>
                  <span>
                    <Check size={13} /> Normalized specs
                  </span>
                  <span>
                    <Check size={13} /> Source traceability
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>ASSET / MODEL</th>
                        <th>TYPE</th>
                        <th>SERIAL NUMBER</th>
                        <th>CPU</th>
                        <th>RAM</th>
                        <th>STORAGE</th>
                        <th>SCREEN</th>
                        <th>REVIEW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a) => (
                        <tr
                          key={a.id}
                          onClick={() => setSelected(a)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setSelected(a);
                          }}
                        >
                          <td>
                            <div className="asset-cell">
                              <span className="device-icon">
                                {a.type === "Laptop" ? (
                                  <Laptop size={18} />
                                ) : (
                                  <Monitor size={18} />
                                )}
                              </span>
                              <div>
                                <strong>
                                  {a.model || "Unidentified asset"}
                                </strong>
                                <small>
                                  {a.manufacturer || "Unknown manufacturer"}{" "}
                                  <span>
                                    · {a.sheet}:{a.row}
                                  </span>
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="type-tag">
                              {a.type || "Unknown"}
                            </span>
                          </td>
                          <td className="serial">{a.serial || "—"}</td>
                          <td className="cpu">{a.cpu || "—"}</td>
                          <td>{a.ram || "—"}</td>
                          <td>{a.storage || "—"}</td>
                          <td>{a.screen || "—"}</td>
                          <td>
                            <span
                              className={
                                a.warnings.length ? "review-tag" : "ok-tag"
                              }
                            >
                              {a.warnings.length ? (
                                <>
                                  <AlertCircle size={12} /> Check
                                </>
                              ) : (
                                <>
                                  <Check size={12} /> Ready
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!visible.length && (
                    <div className="no-results">
                      No assets match this view. Try another search or adjust
                      the column mapping.
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  Showing {visible.length} of {assets.length} assets
                  <span>Original rows preserved · No silent deletions</span>
                </div>
              </>
            )}
          </section>
          <footer>
            <span>
              <Layers3 size={14} /> A clearer view. Better decisions.
            </span>
            <span>Built for the spreadsheets you actually have.</span>
          </footer>
        </div>
      </main>
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Review asset"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setSelected(null)}
              aria-label="Close asset"
            >
              <X />
            </button>
            <div className="eyebrow">ASSET DETAILS</div>
            <h2>{selected.model || "Review asset"}</h2>
            <p className="source">
              {selected.sheet} · Source row {selected.row}
            </p>
            {selected.warnings.map((w) => (
              <div className="warning" key={w}>
                <AlertCircle size={14} />
                {w}
              </div>
            ))}
            <div className="edit-fields">
              {fields.map((f) => (
                <label key={f}>
                  {labels[f]}{" "}
                  {selected.inferred.includes(f) && <em>inferred</em>}
                  <input
                    value={selected[f]}
                    onChange={(e) => {
                      const next = { ...selected, [f]: e.target.value };
                      setSelected(next);
                      setEdits((old) => ({
                        ...old,
                        [next.id]: { ...old[next.id], [f]: e.target.value },
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <h3>Original source values</h3>
            <dl>
              {Object.entries(selected.raw).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="source">
              Edits are saved in this session and included in exports. Review
              warnings describe the original extraction.
            </p>
            <button className="primary" onClick={() => setSelected(null)}>
              <Check size={16} /> Done reviewing
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
