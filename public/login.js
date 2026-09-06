const $ = (selector) => document.querySelector(selector);
let setup = false;
async function status() {
  try {
    const response = await fetch("/auth/status");
    const data = await response.json();
    if (data.user) {
      location.replace("/");
      return;
    }
    setup = data.setupRequired;
    $("#title").textContent = setup
      ? "Crie seu primeiro acesso."
      : "Bem-vindo de volta.";
    $("#subtitle").textContent = setup
      ? "Escolha um usuário e uma senha para proteger seu painel."
      : "Entre para acessar seu painel de leads.";
    $("#confirmation").hidden = !setup;
    $("#confirm").required = setup;
    $("#password").autocomplete = setup ? "new-password" : "current-password";
    $("#submit").innerHTML = setup
      ? "Criar acesso e entrar <span>→</span>"
      : "Entrar no painel <span>→</span>";
    $("#submit").disabled = !data.databaseReady;
    $("#notice").classList.toggle("warning", !data.databaseReady);
    $("#notice").textContent = data.databaseReady
      ? setup
        ? "Banco conectado. Este cadastro fica disponível somente no primeiro acesso local."
        : `Banco ${data.database === "mysql" ? "MySQL" : "local"} conectado. Informe seus dados de acesso.`
      : data.message;
    $("#retry").hidden = data.databaseReady;
  } catch {
    $("#notice").textContent =
      "Não foi possível acessar o servidor. Verifique se a aplicação está em execução.";
    $("#notice").classList.add("warning");
    $("#submit").disabled = true;
    $("#retry").hidden = false;
  }
}
$("#retry").addEventListener("click", status);
$("#toggle-password").addEventListener("click", () => {
  const visible = $("#password").type === "password";
  $("#password").type = visible ? "text" : "password";
  $("#toggle-password").textContent = visible ? "Ocultar" : "Mostrar";
  $("#toggle-password").setAttribute(
    "aria-label",
    visible ? "Ocultar senha" : "Mostrar senha",
  );
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#error").textContent = "";
  if (setup && $("#password").value !== $("#confirm").value) {
    $("#error").textContent = "As senhas não coincidem.";
    return;
  }
  $("#submit").disabled = true;
  try {
    const response = await fetch(setup ? "/auth/setup" : "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-NexTech-Request": "1" },
      body: JSON.stringify({
        username: $("#username").value,
        password: $("#password").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Não foi possível entrar.");
    location.replace("/");
  } catch (error) {
    $("#error").textContent = error.message;
    $("#submit").disabled = false;
  }
});
status();
