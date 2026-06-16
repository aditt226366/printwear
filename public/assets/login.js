const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";

  const response = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: form.username.value,
      password: form.password.value
    })
  });

  const data = await response.json().catch(() => ({ error: "Invalid username or password" }));

  if (response.ok) {
    window.location.href = data.redirectTo || "/dashboard";
    return;
  }

  error.textContent = data.error || "Invalid username or password";
});
