package app.workfence.workforce.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import app.workfence.workforce.wear.ui.NoticesScreen
import app.workfence.workforce.wear.ui.ReplyBanner
import app.workfence.workforce.wear.ui.ShiftScreen
import app.workfence.workforce.wear.ui.TodayScreen
import app.workfence.workforce.wear.ui.TravelScreen
import app.workfence.workforce.wear.ui.WaitingScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The watch app.
 *
 * One activity, four faces, swiped horizontally the way Wear expects rather
 * than buried behind a menu: a worker gets to Today or the notices with a
 * thumb, without reading anything.
 *
 * It asks the phone for a fresh snapshot on every resume. The Data Layer
 * already holds the last thing the phone said — so the screen is never
 * blank — but a watch that has been in a pocket for an hour should not show
 * an hour-old boundary state when the phone is right there.
 */
class MainActivity : ComponentActivity() {

    private lateinit var link: PhoneLink

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        link = PhoneLink(this)
        setContent { WorkfenceWatch(link) }
    }

    override fun onResume() {
        super.onResume()
        link.start()
    }

    override fun onPause() {
        super.onPause()
        link.stop()
    }
}

@Composable
private fun WorkfenceWatch(link: PhoneLink) {
    val state by link.state.collectAsState()
    val reply by link.lastReply.collectAsState()
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    /*
     * The clock the elapsed numbers are drawn from.
     *
     * Ticked here, once a second, rather than pushed from the phone: the
     * watch owns its own seconds, so a shift that is simply running costs no
     * radio at all. The loop only exists while a screen is on.
     */
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    /* Ask for a fresh snapshot on open. Harmless when nothing is listening. */
    LaunchedEffect(Unit) { link.send(Commands.REFRESH) }

    fun ask(command: String) {
        if (busy) return
        busy = true
        scope.launch {
            val delivered = link.send(command)
            if (!delivered) {
                busy = false
                // Said rather than spun: "not connected" is actionable, a
                // spinner that never resolves is not.
                link.clearReply()
            }
        }
    }

    /* The phone answered, so whatever was in flight is finished. */
    LaunchedEffect(reply) { if (reply != null) busy = false }

    MaterialTheme {
        Scaffold(
            modifier = Modifier.fillMaxSize().background(Color.Black),
            timeText = { TimeText() },
        ) {
            when {
                reply != null -> ReplyBanner(reply!!) { link.clearReply() }
                !state.known || state.outdated -> WaitingScreen(state.outdated)
                else -> WatchPager(state, now, busy, ::ask)
            }
        }
    }
}

@Composable
private fun WatchPager(
    state: WatchState,
    now: Long,
    busy: Boolean,
    ask: (String) -> Unit,
) {
    /* Travel earns a page only while a trip is running, so nobody swipes
       past a screen that has nothing to say. */
    val pages = buildList {
        add(Page.SHIFT)
        add(Page.TODAY)
        if (state.travel?.active == true) add(Page.TRAVEL)
        add(Page.NOTICES)
    }
    val pagerState = rememberPagerState(pageCount = { pages.size })

    HorizontalPager(state = pagerState) { index ->
        when (pages[index]) {
            Page.SHIFT -> ShiftScreen(
                state = state,
                now = now,
                busy = busy,
                onBreakStart = { ask(Commands.BREAK_START) },
                onBreakEnd = { ask(Commands.BREAK_END) },
                onCheckOut = { ask(Commands.CHECKOUT) },
            )
            Page.TODAY -> TodayScreen(state, now)
            Page.TRAVEL -> TravelScreen(state, busy) { ask(Commands.TRAVEL_END) }
            Page.NOTICES -> NoticesScreen(state.notices)
        }
    }
}

private enum class Page { SHIFT, TODAY, TRAVEL, NOTICES }
