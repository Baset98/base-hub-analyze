# API directory

This folder contains server-side API code for the project. Place route
handlers, controllers, or API-related utilities here.

Suggested files and structure:

- `api/score.js` - small helper that computes a numeric score and rank for an
	account (already included as an example).
- `api/index.js` or `api/routes.js` - central route registration for Express
	or other frameworks.
- `api/controllers/` - optional folder for controller modules.

Usage notes:

- The project serves static files from the `public/` directory and exposes
	API endpoints under `/api` (for example: `POST /api/score`).
- Keep API-specific code in this folder to make it easy to move to a
	standalone service later if needed.

Contributing:

- Add tests for new endpoints and utilities.
- Document any public API endpoints in the repository README or an OpenAPI
	specification.

Feel free to replace or expand these files according to your project's
architecture and routing conventions.
