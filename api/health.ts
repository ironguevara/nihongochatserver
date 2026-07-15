export default {
  fetch(): Response {
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "Nihongo Chat Server - Gemini",
        configured: Boolean(process.env.GEMINI_API_KEY),
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN?.trim() || "*"
        }
      }
    );
  }
};
