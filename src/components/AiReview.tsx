import { useEffect, useRef, useState } from "react";
import { X, Sparkles, Check } from "lucide-react";
import type { Asset, Field } from "../extract";
import { fields, fieldLabels } from "../asset-fields";
import { analyzeRows, defaultAiColumns } from "../ai";
import type { InputRow, Suggestion } from "../ai-schema";

export interface AiSelection {
  suggestion: Suggestion;
  fields: Field[];
}
interface Props {
  rows: Asset[];
  edits: Record<string, Partial<Asset>>;
  onClose: () => void;
  onApply: (selections: AiSelection[]) => void;
}

export function AiReview({ rows, edits, onClose, onApply }: Props) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.raw)))];
  const [included, setIncluded] = useState(() => defaultAiColumns(columns));
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [chosen, setChosen] = useState<Record<string, Field[]>>({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(
    "Choose columns and inspect exactly what will be sent.",
  );
  const [model, setModel] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const inputs: InputRow[] = rows.map((row) => ({
    id: row.id,
    cells: Object.fromEntries(
      Object.entries(row.raw).filter(
        ([key, value]) => included.includes(key) && value.trim(),
      ),
    ),
  }));
  const count = Object.values(chosen).reduce(
    (total, values) => total + values.length,
    0,
  );

  async function run() {
    const request = new AbortController();
    controller.current = request;
    setRunning(true);
    setSuggestions([]);
    setChosen({});
    setModel("");
    let complete = 0;
    setMessage(`Analyzing 0 of ${rows.length} selected rows…`);
    try {
      await analyzeRows(inputs, request.signal, (batch, usedModel) => {
        complete += batch.length;
        setSuggestions((old) => [...old, ...batch]);
        setModel(usedModel);
        setChosen((old) => ({
          ...old,
          ...Object.fromEntries(
            batch.map((suggestion) => {
              const row = rows.find((row) => row.id === suggestion.id)!;
              const selected = fields.filter(
                (field) =>
                  suggestion.fields[field] &&
                  suggestion.fields[field]!.value !== row[field] &&
                  edits[row.id]?.[field] === undefined &&
                  (!row[field] || row.inferred.includes(field)),
              );
              return [row.id, selected];
            }),
          ),
        }));
        setMessage(
          `Analyzed ${complete} of ${rows.length} rows. Suggestions require your review.`,
        );
      });
    } catch (error) {
      if (request.signal.aborted)
        setMessage(
          `Cancelled. ${complete} completed rows remain available for review.`,
        );
      else
        setMessage(
          `${error instanceof Error ? error.message : "AI request failed."} ${complete} completed rows remain available. Local results are unchanged.`,
        );
    } finally {
      if (!request.signal.aborted || controller.current === request)
        setRunning(false);
    }
  }

  return (
    <div className="overlay ai-overlay" onClick={onClose}>
      <section
        className="ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Review AI extraction"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="close"
          onClick={onClose}
          aria-label="Close AI review"
        >
          <X />
        </button>
        <div className="eyebrow">OPTIONAL AI ASSISTANCE</div>
        <h2>Review {rows.length} selected rows with AI</h2>
        <p className="ai-disclosure">
          Only the selected cells below will be sent through our server to
          OpenAI. Unknown column names are supported. Cells may contain personal
          or internal data: deselect anything you do not want to share. Local
          parsing and results remain available.
        </p>
        <details open={!suggestions.length}>
          <summary>Choose columns and preview the request</summary>
          <div className="ai-columns">
            {columns.map((column) => (
              <label key={column}>
                <input
                  type="checkbox"
                  disabled={running || suggestions.length > 0}
                  checked={included.includes(column)}
                  onChange={(event) =>
                    setIncluded((old) =>
                      event.target.checked
                        ? [...old, column]
                        : old.filter((key) => key !== column),
                    )
                  }
                />
                {column}
              </label>
            ))}
          </div>
          <p className="source">
            Serial and known administrative columns are excluded by default.
            Unknown columns are included. Change the selection before sending.
            Up to 20 unique rows per request; identical selected cells are
            analyzed once per action.
          </p>
          <pre className="ai-preview">
            {JSON.stringify({ rows: inputs }, null, 2)}
          </pre>
        </details>
        <div className="ai-controls">
          <button
            className="primary"
            disabled={
              running ||
              suggestions.length > 0 ||
              inputs.some((row) => !Object.keys(row.cells).length)
            }
            onClick={() => void run()}
          >
            <Sparkles size={15} />
            {running ? "Analyzing…" : "Send selected cells to AI"}
          </button>
          {running && (
            <button
              className="secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancel request
            </button>
          )}
        </div>
        <p className="ai-status" role="status">
          {message}
        </p>
        {model && (
          <p className="source">
            Model: {model}. Evidence is checked against source cells; suggested
            values still need human review.
          </p>
        )}
        {suggestions.map((suggestion) => {
          const row = rows.find((row) => row.id === suggestion.id)!;
          const changes = fields.filter(
            (field) =>
              suggestion.fields[field] &&
              suggestion.fields[field]!.value !== row[field],
          );
          return (
            <article className="ai-row" key={row.id}>
              <h3>
                {row.model || "Unidentified asset"}{" "}
                <small>
                  {row.sheet} · Row {row.row}
                </small>
              </h3>
              {!changes.length && (
                <p className="source">
                  No supported changes suggested for this row.
                </p>
              )}
              {changes.map((field) => {
                const proposal = suggestion.fields[field]!;
                const locked = edits[row.id]?.[field] !== undefined;
                return (
                  <label className="ai-change" key={field}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={
                        !locked && (chosen[row.id] || []).includes(field)
                      }
                      onChange={(event) =>
                        setChosen((old) => ({
                          ...old,
                          [row.id]: event.target.checked
                            ? [...(old[row.id] || []), field]
                            : (old[row.id] || []).filter(
                                (value) => value !== field,
                              ),
                        }))
                      }
                    />
                    <span>
                      <strong>{fieldLabels[field]}</strong>
                      <span className="ai-before">
                        {row[field] || "Empty"} →{" "}
                      </span>
                      <b>{proposal.value}</b>
                      <small>
                        {proposal.sourceColumn}: “{proposal.quote}”
                      </small>
                      {locked ? (
                        <small>Existing edit protected.</small>
                      ) : row[field] && !row.inferred.includes(field) ? (
                        <small>
                          Explicit source value. Select only if you intend to
                          replace it.
                        </small>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </article>
          );
        })}
        <div className="ai-controls ai-apply">
          <button
            className="primary"
            disabled={running || !count}
            onClick={() =>
              onApply(
                suggestions.map((suggestion) => ({
                  suggestion,
                  fields: chosen[suggestion.id] || [],
                })),
              )
            }
          >
            <Check size={15} />
            Apply {count} selected field changes
          </button>
          <button className="secondary" onClick={onClose}>
            Close without applying
          </button>
        </div>
      </section>
    </div>
  );
}
