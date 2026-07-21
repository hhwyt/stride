# functional: create a todo
- add a POST /todos endpoint
- validate the request body
- persist the todo
verify: an integration test posts a todo and asserts a 201 with an id
priority: high

# functional: list todos
- add a GET /todos endpoint
verify: an integration test creates two todos and asserts both are returned
deps: F001

# functional: complete a todo
- add a PATCH /todos/:id endpoint that sets done=true
verify: an integration test completes a todo and asserts done is true
deps: F001

# functional: delete a todo
- add a DELETE /todos/:id endpoint
verify: an integration test deletes a todo and asserts a later GET returns 404
deps: F001
