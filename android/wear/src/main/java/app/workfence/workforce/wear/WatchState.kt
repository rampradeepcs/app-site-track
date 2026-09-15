package app.workfence.workforce.wear

import org.json.JSONObject

/**
 * The phone's snapshot, as the watch holds it.
 *
 * A hand-copy of `src/lib/watch/contract.ts`. Three codebases implement that
 * shape and two of them cannot import it, so it is kept small enough to hold
 * in your head and every field carries the reason it exists.
 *
 * Parsing is total: a watch on an older build than the phone must show
 * something sensible rather than crash on a field it has never heard of, so
 * every read has a default and unknown keys are ignored.
 */

const val WATCH_PROTOCOL = 1

enum class ShiftState { OFF, ON, BREAK }

data class Notice(
    val id: String,
    val title: String,
    val severity: String,
)

data class Capabilities(
    val checkOut: Boolean = false,
    val breaks: Boolean = false,
    val travel: Boolean = false,
)

data class Travel(
    val active: Boolean = false,
    val label: String = "",
)

data class WatchState(
    val protocol: Int = WATCH_PROTOCOL,
    val state: ShiftState = ShiftState.OFF,
    /**
     * When the current state began, epoch ms, or null when off shift.
     *
     * The watch counts up from this itself rather than being fed a ticking
     * number: a wrist out of Bluetooth range keeps showing the right elapsed
     * time, and the phone is not woken once a second to say so.
     */
    val since: Long? = null,
    val workedMs: Long = 0,
    val breakMs: Long = 0,
    val asOf: Long = 0,
    /** null while no fix has been taken, which is not the same as outside
     *  and must not be drawn as if it were. */
    val onSite: Boolean? = null,
    val site: String = "",
    val company: String = "",
    val can: Capabilities = Capabilities(),
    val travel: Travel? = null,
    val notices: List<Notice> = emptyList(),
    /** False until the phone has said anything at all. */
    val known: Boolean = false,
) {
    /** The phone is speaking a shape this build does not know how to read. */
    val outdated: Boolean get() = known && protocol > WATCH_PROTOCOL

    /**
     * Elapsed time in the current state, counted here.
     *
     * Falls back to zero rather than a negative when a watch's clock is
     * behind the phone's, which happens and should not render as "-3m".
     */
    fun elapsedMs(now: Long): Long {
        val from = since ?: return 0
        return (now - from).coerceAtLeast(0)
    }

    /** Worked time including the stretch since the snapshot was taken. */
    fun liveWorkedMs(now: Long): Long =
        if (state == ShiftState.ON && asOf > 0) workedMs + (now - asOf).coerceAtLeast(0)
        else workedMs

    /** Break time including the stretch since the snapshot was taken. */
    fun liveBreakMs(now: Long): Long =
        if (state == ShiftState.BREAK && asOf > 0) breakMs + (now - asOf).coerceAtLeast(0)
        else breakMs

    companion object {
        fun parse(json: String): WatchState = try {
            val o = JSONObject(json)
            val can = o.optJSONObject("can")
            val tr = o.optJSONObject("travel")
            val arr = o.optJSONArray("notices")
            val notices = buildList {
                if (arr != null) for (i in 0 until arr.length()) {
                    val n = arr.optJSONObject(i) ?: continue
                    add(
                        Notice(
                            id = n.optString("id"),
                            title = n.optString("title"),
                            severity = n.optString("severity", "normal"),
                        )
                    )
                }
            }
            WatchState(
                protocol = o.optInt("v", WATCH_PROTOCOL),
                state = when (o.optString("state", "off")) {
                    "on" -> ShiftState.ON
                    "break" -> ShiftState.BREAK
                    else -> ShiftState.OFF
                },
                since = if (o.isNull("since")) null else o.optLong("since"),
                workedMs = o.optLong("workedMs", 0),
                breakMs = o.optLong("breakMs", 0),
                asOf = o.optLong("asOf", 0),
                onSite = if (o.isNull("onSite")) null else o.optBoolean("onSite"),
                site = o.optString("site", ""),
                company = o.optString("company", ""),
                can = Capabilities(
                    checkOut = can?.optBoolean("checkOut") ?: false,
                    breaks = can?.optBoolean("break") ?: false,
                    travel = can?.optBoolean("travel") ?: false,
                ),
                travel = if (tr == null) null else Travel(
                    active = tr.optBoolean("active"),
                    label = tr.optString("label", ""),
                ),
                notices = notices,
                known = true,
            )
        } catch (_: Exception) {
            // A malformed payload is indistinguishable from never having
            // heard: both mean "show the waiting screen", not "crash".
            WatchState()
        }
    }
}

/** What the wrist may ask for. Every one is reversible or additive; the
 *  destructive edge of attendance is check-in, which is not offered here
 *  because no watch has a camera that can take the selfie it requires. */
object Commands {
    const val BREAK_START = "break.start"
    const val BREAK_END = "break.end"
    const val CHECKOUT = "checkout"
    const val TRAVEL_END = "travel.end"
    const val REFRESH = "refresh"
}

/** Paths shared with the phone. Must match contract.ts exactly. */
object Paths {
    const val STATE = "/workfence/shift"
    const val COMMAND = "/workfence/command"
    const val REPLY = "/workfence/reply"
}

/** Clock formatting, in the one shape this product uses: 06h 12m. */
fun formatDuration(ms: Long): String {
    val total = (ms / 60000).coerceAtLeast(0)
    val h = total / 60
    val m = total % 60
    return if (h > 0) String.format("%02dh %02dm", h, m) else String.format("%02dm", m)
}
