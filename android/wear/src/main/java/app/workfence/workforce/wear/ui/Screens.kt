package app.workfence.workforce.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Text
import app.workfence.workforce.wear.Notice
import app.workfence.workforce.wear.ShiftState
import app.workfence.workforce.wear.WatchState
import app.workfence.workforce.wear.formatDuration

/*
 * The watch screens.
 *
 * Written for an arm at a site gate in the sun: one thing per screen, the
 * number large enough to read without stopping, and the action a thumb can
 * hit through a glove. Nothing here scrolls unless it has to.
 *
 * The palette is the phone's, reduced to what an OLED watch should draw —
 * black ground, because on this hardware black is off, and a shift lasts
 * longer than the battery does if it is not.
 */

private val Ink = Color(0xFFF7F7F7)
private val Muted = Color(0xFF9A9A9A)
private val Amber = Color(0xFFE8A33D)
private val Green = Color(0xFF41C784)
private val Red = Color(0xFFE2564D)
private val Surface = Color(0xFF161616)

/* ------------------------------------------------------------ the glance */

/**
 * The one screen most people will ever see.
 *
 * State, elapsed time, and whether they are inside the boundary — the three
 * things a worker actually wants from a wrist — then the single action that
 * makes sense from where they are.
 */
@Composable
fun ShiftScreen(
    state: WatchState,
    now: Long,
    busy: Boolean,
    onBreakStart: () -> Unit,
    onBreakEnd: () -> Unit,
    onCheckOut: () -> Unit,
) {
    val working = state.state == ShiftState.ON
    val onBreak = state.state == ShiftState.BREAK
    val accent = when {
        onBreak -> Amber
        working -> Green
        else -> Muted
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = when {
                onBreak -> "ON BREAK"
                working -> "ON SHIFT"
                else -> "NOT CHECKED IN"
            },
            color = accent,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.4.sp,
        )

        Spacer(Modifier.height(4.dp))

        // The number is the message: elapsed in this state, counted on the
        // watch so it keeps running out of Bluetooth range.
        Text(
            text = if (state.state == ShiftState.OFF) "--" else formatDuration(state.elapsedMs(now)),
            color = Ink,
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
        )

        if (state.site.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(
                text = state.site,
                color = Muted,
                fontSize = 12.sp,
                maxLines = 1,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(6.dp))
        SiteBadge(state.onSite)
        Spacer(Modifier.height(10.dp))

        when {
            busy -> CircularProgressIndicator(modifier = Modifier.size(26.dp), indicatorColor = accent)

            state.state == ShiftState.OFF -> Text(
                // Never a button: no watch on either platform has a camera
                // that can take the selfie a check-in requires, so offering
                // it would be offering something that always fails.
                text = "Check in on your phone",
                color = Muted,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
            )

            onBreak -> WatchAction("End break", Amber, onBreakEnd)

            else -> Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (state.can.breaks) WatchAction("Break", Surface, onBreakStart, ink = Ink)
                if (state.can.checkOut) WatchAction("Check out", Red, onCheckOut)
            }
        }
    }
}

@Composable
private fun WatchAction(label: String, fill: Color, onClick: () -> Unit, ink: Color = Color.Black) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.primaryButtonColors(backgroundColor = fill, contentColor = ink),
        modifier = Modifier.fillMaxWidth().height(44.dp),
    ) {
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** Inside, outside, or not known yet — three states, drawn as three. */
@Composable
private fun SiteBadge(onSite: Boolean?) {
    val (dot, label) = when (onSite) {
        true -> Green to "On site"
        false -> Amber to "Off site"
        null -> Muted to "Locating…"
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.size(5.dp))
        Text(label, color = Muted, fontSize = 12.sp)
    }
}

/* -------------------------------------------------------------- the day */

/** The numbers, for somebody who wants more than the glance. */
@Composable
fun TodayScreen(state: WatchState, now: Long) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("TODAY", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
        Spacer(Modifier.height(10.dp))
        Stat("Worked", formatDuration(state.liveWorkedMs(now)), Green)
        Spacer(Modifier.height(8.dp))
        Stat("Break", formatDuration(state.liveBreakMs(now)), Amber)
        if (state.company.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            Text(state.company, color = Muted, fontSize = 11.sp, maxLines = 2, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun Stat(label: String, value: String, tint: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = tint, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Muted, fontSize = 11.sp)
    }
}

/* ------------------------------------------------------------- the trip */

/** Only reachable when a trip is running; starting one asks for a purpose
 *  and a vehicle, and a form does not belong on a watch. */
@Composable
fun TravelScreen(state: WatchState, busy: Boolean, onEnd: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("TRIP", color = Amber, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
        Spacer(Modifier.height(6.dp))
        if (state.travel?.active == true) {
            Text(
                state.travel.label.ifBlank { "In progress" },
                color = Ink,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
            Spacer(Modifier.height(12.dp))
            if (busy) CircularProgressIndicator(modifier = Modifier.size(26.dp), indicatorColor = Amber)
            else WatchAction("End trip", Amber, onEnd)
        } else {
            Text(
                "No trip running.\nStart one on your phone.",
                color = Muted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/* ---------------------------------------------------------- the notices */

/** Pinned site notices, newest first. The only scrolling screen. */
@Composable
fun NoticesScreen(notices: List<Notice>) {
    if (notices.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("NOTICES", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
            Spacer(Modifier.height(6.dp))
            Text("Nothing pinned.", color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
        return
    }

    val listState = rememberScalingLazyListState()
    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        items(notices) { n ->
            Chip(
                onClick = { /* Reading is the whole interaction; the detail is
                                on the phone, where there is room for it. */ },
                colors = ChipDefaults.chipColors(
                    backgroundColor = Surface,
                    contentColor = Ink,
                ),
                modifier = Modifier.fillMaxWidth(),
                label = {
                    Text(n.title, fontSize = 13.sp, maxLines = 3)
                },
                icon = {
                    Box(
                        Modifier.size(8.dp).clip(CircleShape).background(
                            when (n.severity) {
                                "critical" -> Red
                                "important" -> Amber
                                else -> Muted
                            }
                        )
                    )
                },
            )
        }
    }
}

/* ------------------------------------------------------- nothing to show */

/** The phone has never spoken, or is not there. Said plainly: a spinner that
 *  never resolves is the worst possible answer to "is this working?". */
@Composable
fun WaitingScreen(outdated: Boolean) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("WORKFENCE", color = Amber, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            if (outdated) "Update Workfence on this watch." else "Open Workfence on your phone.",
            color = Muted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/** What the phone said when it refused. Shown where the action was, in the
 *  phone's own words, because it is the thing that knows the rule. */
@Composable
fun ReplyBanner(text: String, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).padding(18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, color = Ink, fontSize = 14.sp, textAlign = TextAlign.Center, maxLines = 5)
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.primaryButtonColors(backgroundColor = Surface, contentColor = Ink),
            ) { Text("OK", fontSize = 13.sp) }
        }
    }
}
