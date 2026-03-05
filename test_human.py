# test_human.py
from cloakbrowser_human import launch
import time

browser = launch(
    headless=False,
    human_preset="default",
    proxy="http://user296388:8cpmj1@89.106.202.176:4586"
)
page = browser.new_page()
page.on("dialog", lambda d: d.accept())

page.goto("https://deviceandbrowserinfo.com/are_you_a_bot_interactions")
time.sleep(2)

t = time.time()
print("email...")
page.type('input[type="email"]', "hello@example.com")
print(f"email: {int((time.time()-t)*1000)}ms")

t = time.time()
print("password...")
page.type('input[type="password"]', "Secure#Pass123")
print(f"password: {int((time.time()-t)*1000)}ms")

t = time.time()
print("submit...")
page.click('button.btn.btn-primary[type="submit"]')
print(f"submit: {int((time.time()-t)*1000)}ms")

time.sleep(3)
text = page.evaluate("() => document.body.innerText || ''")
print("\n=== RESULT ===")
for line in text.split("\n"):
    low = line.lower()
    if any(w in low for w in ["isbot", "you are", "suspicious", "superhuman"]):
        print("  " + line.strip())

browser.close()
