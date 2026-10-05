export default async function globalTeardown(): Promise<void> {
  await globalThis.__PICKET_PG__?.stop();
}
