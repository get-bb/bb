# Typed routes

`defineRoute` accepts `experimental_dependencies(input, output)` and
`experimental_changes(input, output)` from `@bb/domain`. Input contains parsed
`input` and path `params`; successful response bodies determine the output type.
Routes without parsed input use `undefined`.

A write declaring `experimental_changes` requires the `typedRoutes` option
`publishChanges`. After a successful JSON response the route layer validates and
publishes change messages through that callback. Every message identifies an
entity and nonempty change kinds, with an optional ID and value. Failed requests
and non-JSON responses do not publish. Response bodies remain unchanged.
