// const { text } = require("express");

document.getElementById("clearBtn").addEventListener("click", async () => {
  const response = await fetch("/ClearTasks", { method: "DELETE" });
  const data = await response.json();
  alert(data.message);
  document.getElementById("ratsContainer").innerHTML = "";
});