import os
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class WordHunterApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(delete=False)
        self.tmp.close()
        self.audio_library = tempfile.mkdtemp()
        self.audio_cache = tempfile.mkdtemp()
        os.environ["WORD_HUNTER_DB"] = self.tmp.name
        os.environ["WORD_HUNTER_ADMIN_KEY"] = "test-key"
        os.environ["WORD_HUNTER_AUDIO_LIBRARY"] = self.audio_library
        os.environ["WORD_HUNTER_AUDIO_CACHE"] = self.audio_cache

        from app import create_app

        self.client = TestClient(create_app())

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except FileNotFoundError:
            pass
        shutil.rmtree(self.audio_library, ignore_errors=True)
        shutil.rmtree(self.audio_cache, ignore_errors=True)
        os.environ.pop("WORD_HUNTER_AUDIO_LIBRARY", None)
        os.environ.pop("WORD_HUNTER_AUDIO_CACHE", None)

    def test_anonymous_learner_can_start_without_personal_info(self):
        created = self.client.post(
            "/api/admin/learners?key=test-key",
            json={"learning_code": "00001", "password": "leaf8291"},
        )
        self.assertEqual(created.status_code, 200)

        response = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "leaf8291"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data["learner_id"], int)
        self.assertEqual(data["learning_code"], "00001")
        self.assertRegex(data["session_token"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertEqual(data["dashboard"]["seen_total"], 0)
        self.assertEqual(data["dashboard"]["known_total"], 0)
        self.assertEqual(data["dashboard"]["familiar_total"], 0)

    def test_public_signup_is_disabled(self):
        response = self.client.post("/api/learners", json={})

        self.assertEqual(response.status_code, 401)

    def test_first_deck_prioritizes_unseen_words_without_repetition(self):
        learner = self.create_learner("00001")

        response = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=100",
            headers=self.auth_headers(learner),
        )

        self.assertEqual(response.status_code, 200)
        cards = response.json()["cards"]
        self.assertEqual(len(cards), 100)
        self.assertEqual(len({card["word_id"] for card in cards}), 100)
        self.assertEqual([card["position"] for card in cards[:6]], [1, 201, 401, 2, 202, 402])

    def test_deck_resumes_unfinished_round_until_reset(self):
        learner = self.create_learner("00001")
        first_round = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5",
            headers=self.auth_headers(learner),
        ).json()["cards"]

        for card in first_round[:2]:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        resumed = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5",
            headers=self.auth_headers(learner),
        ).json()
        reset = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5&reset=1",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual([card["position"] for card in resumed["cards"]], [401, 2, 202])
        self.assertEqual(resumed["deck_summary"]["remaining"], 3)
        self.assertEqual(reset["deck_summary"]["remaining"], 5)
        self.assertEqual(len(reset["cards"]), 5)

    def test_feedback_updates_word_status_and_daily_dashboard(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3",
            headers=self.auth_headers(learner),
        ).json()["cards"]

        payloads = [
            {"word_id": cards[0]["word_id"], "response": "known", "elapsed_ms": 1200},
            {"word_id": cards[1]["word_id"], "response": "vague", "elapsed_ms": 1600},
            {"word_id": cards[2]["word_id"], "response": "new", "elapsed_ms": 1800},
        ]
        for payload in payloads:
            response = self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json=payload,
                headers=self.auth_headers(learner),
            )
            self.assertEqual(response.status_code, 200)

        dashboard = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers=self.auth_headers(learner),
        ).json()
        self.assertEqual(dashboard["today_seen"], 3)
        self.assertEqual(dashboard["seen_total"], 3)
        self.assertEqual(dashboard["known_total"], 1)
        self.assertEqual(dashboard["familiar_total"], 1)
        self.assertEqual(dashboard["new_friend_total"], 1)
        self.assertEqual(dashboard["streak_days"], 1)

    def test_dashboard_combines_core_and_custom_pack_action_counts(self):
        learner = self.create_learner("00001")
        core_card = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=1",
            headers=self.auth_headers(learner),
        ).json()["cards"][0]
        self.client.post(
            f"/api/learners/{learner['learner_id']}/events",
            json={"word_id": core_card["word_id"], "response": "known", "elapsed_ms": 15000},
            headers=self.auth_headers(learner),
        )
        self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={
                "name": "本周词包",
                "csv_text": "word,meaning\ngeneral,将军\nbattle,战斗\n",
            },
        )
        custom_cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card in custom_cards:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/custom-pack/events",
                headers=self.auth_headers(learner),
                json={
                    "pack_word_id": card["pack_word_id"],
                    "response": "known",
                    "elapsed_ms": 900,
                },
            )

        dashboard = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual(dashboard["today_seen"], 3)
        self.assertEqual(dashboard["seen_total"], 3)
        self.assertEqual(dashboard["core_today_seen"], 1)
        self.assertEqual(dashboard["custom_today_seen"], 2)
        self.assertEqual(dashboard["today_elapsed_ms"], 11800)
        self.assertEqual(dashboard["core_today_elapsed_ms"], 10000)
        self.assertEqual(dashboard["custom_today_elapsed_ms"], 1800)
        self.assertEqual(dashboard["core_seen_total"], 1)
        self.assertEqual(dashboard["custom_seen_total"], 2)
        self.assertEqual(dashboard["known_total"], 1)
        self.assertEqual(dashboard["streak_days"], 1)

    def test_dashboard_reports_current_stage_capture_progress(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card, response in zip(cards, ["known", "known", "vague"]):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": response, "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        dashboard = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual(
            dashboard["stage_capture"],
            {
                "stage_number": 1,
                "label": "第一组",
                "start_position": 1,
                "end_position": 200,
                "target": 200,
                "captured": 2,
                "remaining": 198,
                "complete": False,
                "next_stage_number": 2,
                "next_stage_label": "第二组",
            },
        )

    def test_reset_deck_focuses_on_uncaptured_words_in_current_stage(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card in cards[:2]:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        reset = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5&reset=1",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual([card["position"] for card in reset["cards"]], [401, 2, 202, 402, 3])
        self.assertEqual(reset["deck_summary"]["stage_capture"]["captured"], 2)
        self.assertEqual(reset["deck_summary"]["stage_capture"]["remaining"], 198)

    def test_main_deck_deprioritizes_repeated_new_friends_from_today(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        repeated_new_friend = cards[0]
        for _ in range(2):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={
                    "word_id": repeated_new_friend["word_id"],
                    "response": "new",
                    "elapsed_ms": 3000,
                },
                headers=self.auth_headers(learner),
            )

        reset = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3&reset=1",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual([card["position"] for card in reset["cards"]], [201, 401, 2])
        self.assertNotIn(repeated_new_friend["word_id"], {card["word_id"] for card in reset["cards"]})

    def test_review_deck_returns_new_friend_and_familiar_words_in_current_stage(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=4",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card, response in zip(cards[:3], ["known", "vague", "new"]):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": response, "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        review = self.client.get(
            f"/api/learners/{learner['learner_id']}/review-deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual([card["position"] for card in review["cards"]], [201, 401])
        self.assertEqual(review["review_summary"]["remaining"], 2)
        self.assertEqual(review["review_summary"]["familiar_total"], 1)
        self.assertEqual(review["review_summary"]["new_friend_total"], 1)
        self.assertEqual(review["review_summary"]["stage_capture"]["captured"], 1)

    def test_stage_stays_complete_until_learner_advances(self):
        learner = self.create_learner("00001")
        first_half = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=100",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card in first_half:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )
        second_half = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=100&reset=1",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card in second_half:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        completed_dashboard = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers=self.auth_headers(learner),
        ).json()
        completed_deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=100&reset=1",
            headers=self.auth_headers(learner),
        ).json()
        advanced = self.client.post(
            f"/api/learners/{learner['learner_id']}/stage/advance",
            headers=self.auth_headers(learner),
        ).json()
        next_deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=5&reset=1",
            headers=self.auth_headers(learner),
        ).json()

        self.assertTrue(completed_dashboard["stage_capture"]["complete"])
        self.assertEqual(completed_dashboard["stage_capture"]["stage_number"], 1)
        self.assertEqual(completed_dashboard["stage_capture"]["captured"], 200)
        self.assertEqual(completed_deck["cards"], [])
        self.assertEqual(advanced["stage_capture"]["stage_number"], 2)
        self.assertEqual(advanced["stage_capture"]["captured"], 0)
        self.assertEqual([card["position"] for card in next_deck["cards"]], [467, 68, 268, 468, 69])

    def test_learning_code_restores_existing_learner(self):
        learner = self.create_learner("00001")

        restored = self.client.post(
            "/api/learners",
            json={"learning_code": learner["learning_code"], "password": "leaf8291"},
        ).json()

        self.assertEqual(restored["learner_id"], learner["learner_id"])
        self.assertEqual(restored["learning_code"], learner["learning_code"])
        self.assertNotEqual(restored["session_token"], learner["session_token"])

    def test_wrong_password_is_rejected(self):
        self.client.post(
            "/api/admin/learners?key=test-key",
            json={"learning_code": "00001", "password": "leaf8291"},
        )

        response = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "wrong"},
        )

        self.assertEqual(response.status_code, 401)

    def test_learning_apis_require_matching_session_token(self):
        learner = self.create_learner("00001")

        missing = self.client.get(f"/api/learners/{learner['learner_id']}/dashboard")
        wrong = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers={"X-Word-Hunter-Session": "bad-token"},
        )
        accepted = self.client.get(
            f"/api/learners/{learner['learner_id']}/dashboard",
            headers=self.auth_headers(learner),
        )

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(accepted.status_code, 200)

    def test_same_account_keeps_progress_after_new_login(self):
        learner = self.create_learner("00001")
        card = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=1",
            headers=self.auth_headers(learner),
        ).json()["cards"][0]
        self.client.post(
            f"/api/learners/{learner['learner_id']}/events",
            json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
            headers=self.auth_headers(learner),
        )

        restored = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "leaf8291"},
        ).json()

        self.assertEqual(restored["dashboard"]["today_seen"], 1)
        self.assertEqual(restored["dashboard"]["known_total"], 1)

    def test_admin_summary_requires_key_and_returns_product_data(self):
        self.create_learner("00001")

        rejected = self.client.get("/api/admin/summary")
        accepted = self.client.get("/api/admin/summary?key=test-key")

        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["learner_count"], 1)
        self.assertIn("learners", accepted.json())

    def test_admin_can_reset_password_and_disable_account(self):
        self.create_learner("00001")

        reset = self.client.post(
            "/api/admin/learners/00001/password?key=test-key",
            json={"password": "star5276"},
        )
        old_login = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "leaf8291"},
        )
        new_login = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "star5276"},
        )
        disabled = self.client.patch(
            "/api/admin/learners/00001?key=test-key",
            json={"is_active": False, "display_name": "暂停使用"},
        )
        disabled_login = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "star5276"},
        )

        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["initial_password"], "star5276")
        self.assertEqual(old_login.status_code, 401)
        self.assertEqual(new_login.status_code, 200)
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.json()["is_active"])
        self.assertEqual(disabled.json()["display_name"], "暂停使用")
        self.assertEqual(disabled_login.status_code, 401)

    def test_admin_can_delete_test_account_and_its_learning_data(self):
        learner = self.create_learner("00001")
        card = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=1",
            headers=self.auth_headers(learner),
        ).json()["cards"][0]
        self.client.post(
            f"/api/learners/{learner['learner_id']}/events",
            json={"word_id": card["word_id"], "response": "known", "elapsed_ms": 900},
            headers=self.auth_headers(learner),
        )

        deleted = self.client.delete("/api/admin/learners/00001?key=test-key")
        summary = self.client.get("/api/admin/summary?key=test-key").json()
        login = self.client.post(
            "/api/learners",
            json={"learning_code": "00001", "password": "leaf8291"},
        )

        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        self.assertEqual(summary["learner_count"], 0)
        self.assertEqual(summary["event_count"], 0)
        self.assertEqual(login.status_code, 401)

    def test_admin_can_view_word_detail_for_one_account(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        responses = ["known", "vague", "new"]
        for card, response in zip(cards, responses):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": response, "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        detail = self.client.get("/api/admin/learners/00001/words?key=test-key")

        self.assertEqual(detail.status_code, 200)
        data = detail.json()
        self.assertEqual(data["learner"]["learning_code"], "00001")
        self.assertEqual(len(data["words"]), 3)
        self.assertEqual(data["words"][0]["word"], "I")
        self.assertEqual(data["words"][0]["status_label"], "老朋友")
        self.assertEqual(data["words"][1]["status_label"], "有点眼熟")
        self.assertEqual(data["words"][2]["status_label"], "新朋友")

    def test_admin_can_export_learning_data_for_story_workflow(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card, response in zip(cards, ["known", "vague", "new"]):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": response, "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        exported = self.client.get("/api/admin/learners/00001/export?key=test-key")

        self.assertEqual(exported.status_code, 200)
        data = exported.json()
        self.assertEqual(data["learning_code"], "00001")
        self.assertEqual(data["word_buckets"]["known"][0]["word"], "I")
        self.assertEqual(data["word_buckets"]["familiar"][0]["word"], "am")
        self.assertEqual(data["word_buckets"]["new_friend"][0]["word"], "notice")

    def test_logged_in_learner_can_export_own_learning_data(self):
        learner = self.create_learner("00001")
        cards = self.client.get(
            f"/api/learners/{learner['learner_id']}/deck?limit=3",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card, response in zip(cards, ["known", "vague", "new"]):
            self.client.post(
                f"/api/learners/{learner['learner_id']}/events",
                json={"word_id": card["word_id"], "response": response, "elapsed_ms": 900},
                headers=self.auth_headers(learner),
            )

        missing = self.client.get(f"/api/learners/{learner['learner_id']}/export")
        exported = self.client.get(
            f"/api/learners/{learner['learner_id']}/export",
            headers=self.auth_headers(learner),
        )

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(exported.status_code, 200)
        self.assertIn("text/csv", exported.headers["content-type"])
        self.assertIn(
            'attachment; filename="word-hunter-00001-',
            exported.headers["content-disposition"],
        )
        csv_text = exported.content.decode("utf-8-sig")
        self.assertIn('"学习编号","导出时间","词状态","单词","中文","见过次数","最后学习时间"', csv_text)
        self.assertIn("00001", csv_text)
        self.assertIn('"老朋友","I","我","1"', csv_text)
        self.assertIn('"有点眼熟","am","是（用于 I）","1"', csv_text)
        self.assertIn('"新朋友","notice","注意到","1"', csv_text)

    def test_learner_can_import_custom_word_pack_and_practice_it(self):
        learner = self.create_learner("00001")
        imported = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={
                "name": "本周词包",
                "csv_text": "word,meaning\ngeneral,将军\nbattle,战斗\ncompass,指南针\n",
            },
        )

        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["pack_summary"]["name"], "本周词包")
        self.assertEqual(imported.json()["pack_summary"]["total"], 3)
        self.assertEqual(imported.json()["pack_summary"]["captured"], 0)

        deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()
        self.assertEqual([card["word"] for card in deck["cards"]], ["general", "battle", "compass"])
        self.assertEqual(deck["pack_summary"]["remaining"], 3)

        event = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack/events",
            headers=self.auth_headers(learner),
            json={
                "pack_word_id": deck["cards"][0]["pack_word_id"],
                "response": "known",
                "elapsed_ms": 900,
            },
        )
        summary = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual(event.status_code, 200)
        self.assertEqual(event.json()["pack_summary"]["captured"], 1)
        self.assertEqual(summary["pack_summary"]["captured"], 1)
        self.assertEqual(summary["pack_summary"]["remaining"], 2)

    def test_custom_word_pack_can_be_practiced_again_after_all_words_are_captured(self):
        learner = self.create_learner("00001")
        self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={
                "name": "本周词包",
                "csv_text": "word,meaning\ngeneral,将军\nbattle,战斗\n",
            },
        )
        first_round = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()["cards"]
        for card in first_round:
            self.client.post(
                f"/api/learners/{learner['learner_id']}/custom-pack/events",
                headers=self.auth_headers(learner),
                json={
                    "pack_word_id": card["pack_word_id"],
                    "response": "known",
                    "elapsed_ms": 900,
                },
            )

        second_round = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()

        self.assertTrue(second_round["pack_summary"]["complete"])
        self.assertEqual(second_round["pack_summary"]["captured"], 2)
        self.assertEqual([card["word"] for card in second_round["cards"]], ["general", "battle"])

    def test_learner_can_import_custom_word_pack_as_raw_csv_file(self):
        learner = self.create_learner("00001")
        imported = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack/upload?name=本周词包",
            headers={**self.auth_headers(learner), "Content-Type": "text/csv; charset=utf-8"},
            content="word,meaning\ngeneral,将军\nbattle,战斗\ncompass,指南针\n".encode("utf-8"),
        )

        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["pack_summary"]["name"], "本周词包")
        self.assertEqual(imported.json()["pack_summary"]["total"], 3)

        deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()
        self.assertEqual([card["word"] for card in deck["cards"]], ["general", "battle", "compass"])

    def test_learner_can_import_custom_word_pack_as_multipart_file(self):
        learner = self.create_learner("00001")
        imported = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack/upload?name=本周词包",
            headers=self.auth_headers(learner),
            files={
                "file": (
                    "words.csv",
                    "word,meaning\ngeneral,将军\nbattle,战斗\n".encode("utf-8"),
                    "text/csv",
                )
            },
        )

        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["pack_summary"]["name"], "本周词包")
        self.assertEqual(imported.json()["pack_summary"]["total"], 2)

        deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()
        self.assertEqual([card["word"] for card in deck["cards"]], ["general", "battle"])

    def test_importing_custom_word_pack_replaces_previous_current_pack(self):
        learner = self.create_learner("00001")
        first = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={
                "name": "旧词包",
                "csv_text": "word,meaning\ngeneral,将军\nbattle,战斗\n",
            },
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={
                "name": "新词包",
                "csv_text": "word,meaning\nisland,岛\n",
            },
        )
        deck = self.client.get(
            f"/api/learners/{learner['learner_id']}/custom-pack/deck?limit=10",
            headers=self.auth_headers(learner),
        ).json()

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["pack_summary"]["name"], "新词包")
        self.assertEqual(second.json()["pack_summary"]["total"], 1)
        self.assertEqual([card["word"] for card in deck["cards"]], ["island"])

    def test_custom_word_pack_rejects_empty_or_oversized_upload(self):
        learner = self.create_learner("00001")
        empty = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={"name": "空词包", "csv_text": "word,meaning\n"},
        )
        oversized_csv = "word,meaning\n" + "\n".join(
            f"word{i},意思{i}" for i in range(101)
        )
        oversized = self.client.post(
            f"/api/learners/{learner['learner_id']}/custom-pack",
            headers=self.auth_headers(learner),
            json={"name": "太多词", "csv_text": oversized_csv},
        )

        self.assertEqual(empty.status_code, 422)
        self.assertEqual(oversized.status_code, 422)

    def test_audio_endpoint_prefers_own_audio_library(self):
        own_audio = b"own-library-mp3"
        audio_path = Path(self.audio_library) / "us" / "i.mp3"
        audio_path.parent.mkdir(parents=True)
        audio_path.write_bytes(own_audio)

        response = self.client.get("/api/audio/1?voice=us")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, own_audio)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.headers["x-word-hunter-audio-source"], "library")

    def test_audio_endpoint_fetches_youdao_and_writes_cache_when_library_missing(self):
        import app as app_module

        original_fetch = app_module.fetch_youdao_audio
        app_module.fetch_youdao_audio = lambda word, voice: b"youdao-mp3"
        try:
            response = self.client.get("/api/audio/1?voice=us")
        finally:
            app_module.fetch_youdao_audio = original_fetch

        cache_path = Path(self.audio_cache) / "youdao" / "us" / "i.mp3"
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"youdao-mp3")
        self.assertEqual(response.headers["x-word-hunter-audio-source"], "youdao")
        self.assertEqual(cache_path.read_bytes(), b"youdao-mp3")

    def create_learner(self, learning_code: str):
        created = self.client.post(
            "/api/admin/learners?key=test-key",
            json={"learning_code": learning_code, "password": "leaf8291"},
        )
        self.assertEqual(created.status_code, 200)
        logged_in = self.client.post(
            "/api/learners",
            json={"learning_code": learning_code, "password": "leaf8291"},
        )
        self.assertEqual(logged_in.status_code, 200)
        return logged_in.json()

    def auth_headers(self, learner):
        return {"X-Word-Hunter-Session": learner["session_token"]}


if __name__ == "__main__":
    unittest.main()
