(() => {
  const endpoint = "https://visitor-log.nilkamals463352.chatgpt.site/api/visit";
  fetch(endpoint, {
    method: "POST",
    mode: "cors",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "nwea-research-works",
      page: `${location.pathname}${location.search}${location.hash}`,
      title: document.title,
    }),
  }).catch(() => {});
})();
