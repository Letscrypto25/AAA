import http from "http";
const port = Number(process.env.PORT) || 8000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Test server listening on ${port}`);
  });
