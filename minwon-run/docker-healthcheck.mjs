try {
  const response = await fetch("http://127.0.0.1:8000/healthz");
  const body = await response.json();
  if (!response.ok || body?.status !== "ok") {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
