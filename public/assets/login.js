const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";

  const response = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: form.email.value,
      password: form.password.value
    })
  });

  if (response.ok) {
    window.location.href = "/dashboard";
    return;
  }

  const data = await response.json().catch(() => ({ error: "Login failed" }));
  error.textContent = data.error || "Login failed";
});
