// Aligned API — server entry point. Builds the app (app.ts) and starts listening.
import 'dotenv/config';
import { createApp } from './app';

const app = createApp();
const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`aligned-api listening on http://localhost:${PORT}`);
});
