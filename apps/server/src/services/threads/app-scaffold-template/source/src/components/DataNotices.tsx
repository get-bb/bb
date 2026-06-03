import type { DataNoticesProps } from "../types";

/**
 * Surfaces data-layer problems from the live binding: records under `todos/`
 * that didn't match the todo shape, and the latest SDK error. Renders nothing
 * when everything is healthy.
 */
export function DataNotices(props: DataNoticesProps) {
  if (props.invalidCount === 0 && props.errorMessage === null) {
    return null;
  }

  return (
    <div className="data-notices">
      {props.invalidCount > 0 ? (
        <p className="notice notice-warning">
          {props.invalidCount} record under <code>todos/</code> didn’t match the
          todo shape and was skipped.
        </p>
      ) : null}
      {props.errorMessage !== null ? (
        <p className="notice notice-error">{props.errorMessage}</p>
      ) : null}
    </div>
  );
}
