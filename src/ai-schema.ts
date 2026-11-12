import { z } from "zod";
import { fields, type Field } from "./asset-fields";
export const AI_BATCH_SIZE = 20;
export const AI_SELECTION_LIMIT = 100;
export const AiInputRow = z
  .object({
    id: z.string().min(1).max(160),
    cells: z
      .record(z.string().min(1).max(200), z.string().min(1).max(2000))
      .refine(
        (cells) =>
          Object.keys(cells).length > 0 && Object.keys(cells).length <= 50,
        "Choose 1–50 nonempty columns per row.",
      ),
  })
  .strict();
export const AiRequest = z
  .object({ rows: z.array(AiInputRow).min(1).max(AI_BATCH_SIZE) })
  .strict()
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.id)).size === input.rows.length,
    "Row IDs must be unique.",
  )
  .refine(
    (input) => JSON.stringify(input).length <= 32000,
    "Selected cells exceed the request size limit. Choose fewer columns or rows.",
  );
const Evidence = z
  .object({
    value: z.string().min(1).max(300),
    sourceColumn: z.string().min(1).max(200),
    quote: z.string().min(1).max(600),
  })
  .strict()
  .nullable();
export const AiSuggestion = z
  .object({
    id: z.string().min(1).max(160),
    fields: z
      .object(
        Object.fromEntries(fields.map((field) => [field, Evidence])) as Record<
          Field,
          typeof Evidence
        >,
      )
      .strict(),
  })
  .strict();
export const AiResult = z
  .object({ rows: z.array(AiSuggestion).max(AI_BATCH_SIZE) })
  .strict();
export type InputRow = z.infer<typeof AiInputRow>;
export type Suggestion = z.infer<typeof AiSuggestion>;
export type AiOutput = z.infer<typeof AiResult>;

// Schema adherence does not establish correctness. Validate IDs and quoted sources too.
export function validateAiResult(data: unknown, input: InputRow[]): AiOutput {
  const result = AiResult.parse(data);
  const ids = new Set(result.rows.map((row) => row.id));
  if (ids.size !== input.length || result.rows.length !== input.length)
    throw Error("AI returned missing or duplicate row IDs.");
  for (const row of result.rows) {
    const original = input.find((item) => item.id === row.id);
    if (!original) throw Error("AI returned an unknown row ID.");
    for (const field of fields) {
      const value = row.fields[field];
      if (value && !original.cells[value.sourceColumn]?.includes(value.quote))
        throw Error(
          "AI returned evidence that is not present in the selected cells.",
        );
    }
  }
  return result;
}
