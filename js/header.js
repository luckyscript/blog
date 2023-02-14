
var theme = window.theme || localStorage.getItem('theme');
if (theme === "dark") {
  document.documentElement.setAttribute('data-theme', 'dark');
}
