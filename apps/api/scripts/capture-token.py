"""
Перехват токена YAZIO с телефона — для аккаунта, у которого пароля нет.

Аккаунт, заведённый через Apple ID, паролем не открывается: Apple выдаёт вход
только самому приложению YAZIO. Единственный способ пустить туда экспортёр —
взять пропуск, который приложение уже получило, прямо из его трафика (D-017).

Скрипт — дополнение к mitmproxy. Он смотрит запросы к yzapi.yazio.com, достаёт
из них access- и refresh-токены и, если задан адрес сервиса, сам заводит
аккаунт — вставлять руками ничего не нужно.

    # только показать токены
    mitmdump -s scripts/capture-token.py

    # показать и сразу добавить аккаунт в экспортёр
    YZ_URL=http://localhost:4090 YZ_PASSWORD=<пароль сервиса> \
    YZ_LABEL=второй mitmdump -s scripts/capture-token.py

Дальше: на телефоне в настройках Wi-Fi прописать этот компьютер прокси-сервером
(порт 8080), зайти браузером на http://mitm.it и поставить сертификат, включить
его в «Настройки → Основные → Об этом устройстве → Доверие сертификатам».
Потом — открыть YAZIO.

Refresh-токен появляется только в момент входа, поэтому надёжнее всего выйти из
приложения и зайти заново через Apple: вход через Apple работает всегда, ничего
не теряется.

Перехваченный файл трафика содержит токены и данные о здоровье — не хранить и
никуда не выкладывать.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

HOST = "yazio.com"


class YazioTokenCapture:
    def __init__(self) -> None:
        self.access: str | None = None
        self.refresh: str | None = None
        self.reported = False
        self.added = False

    # ── mitmproxy зовёт это на каждый ответ ────────────────────────────────
    def response(self, flow) -> None:  # noqa: ANN001 — тип из mitmproxy
        if HOST not in flow.request.pretty_host:
            return

        self._from_header(flow)
        self._from_body(flow)
        self._report()

    def _from_header(self, flow) -> None:  # noqa: ANN001
        header = flow.request.headers.get("Authorization", "")
        if header.startswith("Bearer ") and len(header) > 20:
            token = header[len("Bearer ") :].strip()
            if token != self.access:
                self.access = token
                self.reported = False

    def _from_body(self, flow) -> None:  # noqa: ANN001
        # ловим любой ответ с access_token, а не только /oauth/token: обмен
        # токена Apple может идти по другому пути, и он нам тоже подходит
        if b"access_token" not in (flow.response.content or b""):
            return
        try:
            payload = json.loads(flow.response.content)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        if isinstance(payload.get("access_token"), str):
            self.access = payload["access_token"]
            self.reported = False
        if isinstance(payload.get("refresh_token"), str):
            self.refresh = payload["refresh_token"]
            self.reported = False
            print(f"\n  токен выдан по пути {flow.request.path}")

    # ── вывод и добавление аккаунта ────────────────────────────────────────
    def _report(self) -> None:
        if self.reported or not self.access:
            return
        self.reported = True

        print("\n" + "─" * 72)
        print("  Токен YAZIO пойман")
        print(f"  access token : {self.access}")
        print(f"  refresh token: {self.refresh or 'ещё не видели — выйдите и зайдите заново'}")
        print("─" * 72)

        if not self.refresh:
            print("  Без refresh-токена доступ протухнет через 48 часов.")
            print("  Выйдите в приложении и зайдите заново через Apple — токен")
            print("  выдадут при входе, и он появится здесь.\n")

        if self.refresh and not self.added:
            self._add_account()

    def _add_account(self) -> None:
        base = os.environ.get("YZ_URL")
        password = os.environ.get("YZ_PASSWORD")
        if not base or not password:
            print("  Вставьте оба значения в форму «Готовый токен» в экспортёре.")
            print("  (или задайте YZ_URL и YZ_PASSWORD — заведу аккаунт сам)\n")
            return

        base = base.rstrip("/")
        try:
            cookie = self._login(base, password)
            body = {
                "email": "",
                "accessToken": self.access,
                "refreshToken": self.refresh,
            }
            label = os.environ.get("YZ_LABEL")
            if label:
                body["label"] = label

            account = self._post(f"{base}/api/accounts", body, cookie)
            self.added = True
            print(f"  Аккаунт добавлен: {account.get('email')} (id {account.get('id')})")
            print("  Дальше — «Синхронизировать» в интерфейсе.\n")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            print(f"  Не удалось добавить аккаунт: HTTP {error.code} {detail}\n")
        except Exception as error:  # noqa: BLE001 — падать посреди перехвата нельзя
            print(f"  Не удалось добавить аккаунт: {error}\n")

    def _login(self, base: str, password: str) -> str:
        request = urllib.request.Request(
            f"{base}/api/auth/login",
            data=json.dumps({"password": password}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            cookies = response.headers.get_all("Set-Cookie") or []
        session = [c.split(";")[0] for c in cookies if c.startswith("yz_session=")]
        if not session:
            raise RuntimeError("сервис не выдал сессию — проверьте YZ_PASSWORD")
        return session[0]

    def _post(self, url: str, body: dict, cookie: str) -> dict:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Cookie": cookie},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())


addons = [YazioTokenCapture()]
