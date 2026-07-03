# Testing

- Run the unit suite before pushing.
- Integration tests use an in-memory database; never mock the storage layer.
- Every bug fix ships with a regression test that fails before the fix.
