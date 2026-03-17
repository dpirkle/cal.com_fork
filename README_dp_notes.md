## Debugger

Run via the `Next.js Node Debug` launch config. This will let you catch breakpoints in the server code, include api endpoints and email delivery.

If you need to change the version of Node that is being used, do this: `nvm alias default 24`


## Docker

Copy the `.env.docker` to `.env` to build a docker image that will run locally. Restore `.env` by copying `.env.yarn` to `.env`.