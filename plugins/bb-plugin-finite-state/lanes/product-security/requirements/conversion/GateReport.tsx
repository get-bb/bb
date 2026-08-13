import { Icon } from "@bb/shared-ui/icon";
import type { ConversionGateResult } from "./validate.js";

function GateMark({ ok, pending = false }: { ok: boolean; pending?: boolean }): React.JSX.Element {
  const name = pending ? "CircleDashed" : ok ? "CircleCheck" : "CircleX";
  return <Icon aria-hidden="true" className={pending ? "size-4 text-muted-foreground" : ok ? "size-4 text-primary" : "size-4 text-destructive"} name={name} />;
}

export function GateReport({ results }: { results: readonly ConversionGateResult[] }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border" aria-label="Conversion gate report">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Requirement</th>
            <th className="px-3 py-2 font-medium">Schema + EARS</th>
            <th className="px-3 py-2 font-medium">Round trip</th>
            <th className="px-3 py-2 font-medium">Human diff</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {results.map((result) => (
            <tr key={result.requirementId}>
              <td className="px-3 py-2 font-medium">{result.requirementId}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2"><GateMark ok={result.schema.ok} />{result.schema.ok ? "Passed" : `${result.schema.errors.length} errors`}</span>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2"><GateMark ok={result.roundTrip.ok} />{result.roundTrip.staleSource ? "Source changed" : result.roundTrip.ok ? "Passed" : `${result.roundTrip.unresolved.length} unresolved`}</span>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2"><GateMark ok={result.humanReview === "reviewed"} pending={result.humanReview === "pending"} />{result.humanReview === "pending" ? "Awaiting human" : result.humanReview}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
