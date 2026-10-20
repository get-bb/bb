# Typed routes

`defineRoute` accepts `tags(input, output)` and `invalidates(input, output)`
declarations from `@bb/domain`. Route tag input
contains parsed `input` and path `params`; successful response bodies determine
the output type. Routes without parsed input use `undefined`.

Registering a route with `invalidates` requires the `typedRoutes` option
`invalidateTags`. After a successful JSON response, the route layer publishes
its deduplicated tags through that callback. Response bodies remain unchanged.
Failed requests and non-JSON responses do not publish tags.
