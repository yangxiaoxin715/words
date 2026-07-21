import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WordHunterUiCopyTest(unittest.TestCase):
    def test_visible_product_name_uses_friend_language(self):
        for page in ["index.html", "privacy.html", "admin.html"]:
            html = (ROOT / "public" / page).read_text(encoding="utf-8")
            self.assertIn("和单词交朋友", html)
            self.assertNotIn("单词猎人", html)

    def test_dashboard_and_response_copy_use_friend_language(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")

        for text in ["今日见面", "今天陪伴", "累计见面", "连续来玩", "新朋友", "有点眼熟", "老朋友"]:
            self.assertIn(text, html)

        for old_text in ["已见过", "已认识", "变熟中", "连续完成", "认识", "有印象", "今日用时", "连续见面"]:
            self.assertNotIn(old_text, html)

    def test_flashcard_has_hunt_and_manual_modes(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")

        for text in ["自动模式", "手动模式", "开始交朋友"]:
            self.assertIn(text, html)

        for old_text in ["猎词模式", "开始猎词"]:
            self.assertNotIn(old_text, html)

        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        for name in ["startHuntMode", "finishHuntTimeout", "setMode"]:
            self.assertIn(name, js)

    def test_user_entry_uses_private_login_language(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for text in ["编号", "密码", "登录后开始刷词", "导出数据"]:
            self.assertIn(text, html)

        for old_text in ["学习编号", "找回已有进度", "学习码找回"]:
            self.assertNotIn(old_text, html)

        self.assertIn("sessionToken", js)
        self.assertIn("X-Word-Hunter-Session", js)

    def test_header_keeps_english_signal_and_places_code_before_logout(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        topbar_start = html.index('class="topbar"')
        topbar_end = html.index("</header>", topbar_start)
        tool_start = html.index('class="tool-panel"')
        tool_end = html.index("</details>", tool_start)
        code_index = html.find('id="visibleLearningCode"', topbar_start, topbar_end)
        logout_index = html.find('id="logoutBtn"', topbar_start, topbar_end)

        self.assertIn("Welcome to make friends with words!", html[topbar_start:topbar_end])
        self.assertIn('class="topbar-main"', html[topbar_start:topbar_end])
        self.assertIn(".topbar-main", (ROOT / "public" / "styles.css").read_text(encoding="utf-8"))
        self.assertIn("min-width: 0", (ROOT / "public" / "styles.css").read_text(encoding="utf-8"))
        self.assertIn("align-items: flex-start", (ROOT / "public" / "styles.css").read_text(encoding="utf-8"))
        self.assertIn('id="accountCodeLine"', html[topbar_start:topbar_end])
        self.assertNotEqual(code_index, -1)
        self.assertNotEqual(logout_index, -1)
        self.assertLess(code_index, logout_index)
        self.assertIn('id="visibleLearningCode"', html[topbar_start:topbar_end])
        self.assertNotIn('id="learningCode"', html[topbar_start:topbar_end])
        self.assertNotIn("学习编号", html[topbar_start:topbar_end])
        self.assertNotIn('id="learningCode"', html[tool_start:tool_end])
        self.assertNotIn('class="code-line"', html[tool_start:tool_end])
        self.assertIn("visibleLearningCode", js)

    def test_user_can_export_learning_data_from_home_page(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="exportDataBtn"', html)
        self.assertIn("导出数据", html)
        self.assertIn("function exportLearningData", js)
        self.assertIn("/export", js)
        self.assertIn("downloadBlob", js)
        self.assertIn(".csv", js)
        self.assertIn("response.blob()", js)

    def test_admin_can_create_private_learning_accounts(self):
        html = (ROOT / "public" / "admin.html").read_text(encoding="utf-8")

        for text in [
            "后台口令",
            "创建学习账号",
            "学习编号",
            "初始密码",
            "账号列表",
            "词明细",
            "导出",
            "重置密码",
            "停用",
            "删除",
        ]:
            self.assertIn(text, html)

        self.assertNotIn("管理口令", html)

        for endpoint in ["/words", "/export", "/password"]:
            self.assertIn(endpoint, html)

    def test_privacy_copy_matches_private_account_model(self):
        html = (ROOT / "public" / "privacy.html").read_text(encoding="utf-8")

        for text in ["学习编号", "加密后的登录密码", "不保存明文密码"]:
            self.assertIn(text, html)

        self.assertNotIn("匿名学习 ID", html)
        self.assertNotIn("学习码", html)

    def test_public_copy_uses_neutral_user_language(self):
        public_text = "\n".join(
            (ROOT / path).read_text(encoding="utf-8")
            for path in ["public/index.html", "public/privacy.html", "备案材料.md", "README.md"]
        )

        for text in ["孩子", "家长", "未成年人", "成年人"]:
            self.assertNotIn(text, public_text)

        for text in ["真实身份", "联系方式", "闪卡学习数据"]:
            self.assertIn(text, public_text)

    def test_hunt_mode_reveals_meaning_before_next_word(self):
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for name in ["HUNT_REVEAL_MS", "showHuntAnswerForChoice", "showHuntTimeoutAnswer", "huntAwaitingChoice"]:
            self.assertIn(name, js)

    def test_hunt_mode_click_means_ready_to_check_not_new_friend(self):
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        self.assertIn("function updateResponseButtons", js)
        self.assertIn('button.dataset.response === "new"', js)

    def test_flashcard_progress_shows_remaining_count(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        self.assertIn("还剩 100 个", html)
        self.assertNotIn("第 1 个 ｜", html)
        self.assertIn("remaining", js)
        self.assertIn("还剩 ${remaining} 个", js)

    def test_mobile_home_is_light_before_the_immersive_session(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        home_index = html.index('id="homePanel"')
        session_index = html.index('id="sessionPanel"')
        progress_band_index = html.find('class="progress-band"')

        self.assertLess(home_index, session_index)
        self.assertLess(html.index('id="startSessionBtn"'), html.index('class="tool-panel"'))
        self.assertIn("<summary>工具</summary>", html)
        self.assertIn('class="home-stats-grid"', html)
        self.assertIn("Welcome to make friends with words!", html)
        self.assertEqual(html.count("Welcome to make friends with words!"), 1)
        self.assertNotIn("<span>Welcome</span>", html)
        self.assertIn("english-signal", html)
        self.assertIn(".english-signal", css)
        self.assertIn("white-space: nowrap", css)
        english_signal_start = css.index(".english-signal")
        english_signal_end = css.index(".topbar .english-signal", english_signal_start)
        english_signal_css = css[english_signal_start:english_signal_end]
        self.assertIn("font-size: clamp(10px, 2.8vw, 12px)", english_signal_css)
        self.assertNotIn("text-overflow: ellipsis", english_signal_css)
        self.assertNotIn("overflow: hidden", english_signal_css)
        self.assertIn(".primary-button.home-start-button", css)
        self.assertIn("background: linear-gradient(135deg, #ff9f1c, #ff6b35)", css)
        self.assertIn("min-height: 72px", css)
        self.assertIn("border-radius: 22px", css)
        self.assertIn("function showHome", js)
        self.assertIn("function startPracticeSession", js)
        self.assertEqual(progress_band_index, -1)

    def test_immersive_session_keeps_feedback_under_the_card(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for item in [
            'id="sessionBackBtn"',
            'id="sessionTitle"',
            'id="sessionCounter"',
            'class="response-grid response-dock hidden"',
        ]:
            self.assertIn(item, html)

        for item in ["刷词中", "返回"]:
            self.assertIn(item, html)

        for name in ["showSession", "showHome", "updateSessionHeader"]:
            self.assertIn(name, js)

        self.assertIn(".session-panel", css)
        self.assertIn(".response-dock", css)
        self.assertIn(".response-dock .response", css)
        self.assertIn("min-height: 72px", css)
        self.assertIn("font-size: 18px", css)
        self.assertIn("position: sticky", css)
        self.assertIn("bottom: max(40px, calc(env(safe-area-inset-bottom) + 24px))", css)

    def test_auto_mode_has_subtle_three_second_countdown(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for item in ['id="countdownTrack"', 'id="countdownFill"']:
            self.assertIn(item, html)

        for item in [".countdown-track", ".countdown-fill"]:
            self.assertIn(item, css)

        for item in ["function startCountdown", "function stopCountdown", "HUNT_TIMEOUT_MS"]:
            self.assertIn(item, js)

        self.assertIn("startCountdown()", js)
        self.assertIn("stopCountdown()", js)

    def test_mobile_flash_card_uses_larger_word_and_compositor_countdown(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        self.assertIn("font-size: clamp(54px, 10svh, 86px)", css)
        self.assertIn("contain: layout paint", css)
        self.assertIn("countdown-track countdown-idle", html)
        self.assertIn(".countdown-track.countdown-idle", css)
        self.assertIn("transform: scaleX(1)", css)
        self.assertIn("will-change: transform", css)
        self.assertIn("scaleX(0)", js)
        self.assertNotIn('countdownFill.style.width = "0%"', js)

    def test_stage_capture_progress_is_visible(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for text in ["阶段捕获", "还差 200 个", "召唤剩余", "再见一面", "进入第二组"]:
            self.assertIn(text, html)

        for name in ["stage_capture", "updateStageCapture", "advanceStage", "sprintStage", "loadReviewDeck"]:
            self.assertIn(name, js)

        self.assertNotIn("未捕获词", html)
        self.assertNotIn("冲刺剩下", html)
        self.assertNotIn("新朋友复习", html)

    def test_custom_word_pack_copy_stays_tool_focused(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")

        for text in ["导入词包", "刷导入词包", "导出数据"]:
            self.assertIn(text, html)

        for name in ["customPack", "importCustomPack", "loadCustomPackDeck", "submitCustomPackResponse"]:
            self.assertIn(name, js)

        self.assertIn('for="customPackFile"', html)
        self.assertIn('class="ghost-button file-import-button"', html)
        self.assertIn('class="file-input-native"', html)
        self.assertIn(".file-input-native", css)
        self.assertNotIn('el.customPackFile.click()', js)
        self.assertIn('el.customPackFile.value = ""', js)
        self.assertIn('el.customPackFile.addEventListener("change", importCustomPack)', js)
        self.assertNotIn("2000词主线", html)
        self.assertNotIn("核心词表", html)
        self.assertNotIn("自定义词包", html)
        self.assertNotIn("选择 CSV", html)

        for text in ["故事词包", "故事", "课程词包", "老师下发"]:
            self.assertNotIn(text, html)

    def test_static_assets_are_versioned_to_avoid_stale_mobile_scripts(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")

        self.assertRegex(html, r'href="/styles\.css\?v=\d{8}-\d+"')
        self.assertRegex(html, r'src="/app\.js\?v=\d{8}-\d+"')

    def test_next_round_is_the_only_place_that_resets_deck(self):
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        self.assertIn("options.reset", js)
        self.assertIn("&reset=1", js)
        self.assertIn("loadDeck({ reset: true })", js)

    def test_learning_time_is_visible_on_dashboard_and_completion(self):
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

        for item in [
            'id="todayTime"',
            'id="coreTodayTime"',
            'id="customTodayTime"',
            "今天陪伴",
            "核心用时",
            "导入用时",
        ]:
            self.assertIn(item, html)

        for item in [
            "formatDuration",
            "today_elapsed_ms",
            "core_today_elapsed_ms",
            "custom_today_elapsed_ms",
            "sessionElapsedMs",
            "本轮用时",
        ]:
            self.assertIn(item, js)


if __name__ == "__main__":
    unittest.main()
