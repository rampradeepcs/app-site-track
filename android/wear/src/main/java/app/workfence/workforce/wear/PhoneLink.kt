package app.workfence.workforce.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The wire to the phone.
 *
 * Two channels, because they answer different questions. State arrives on the
 * Data Layer, which is a replicated key/value store: it survives the watch
 * being out of range, so a wrist raised after an hour in a basement shows the
 * last thing that was true rather than nothing. Commands go out as messages,
 * which are delivered now or not at all — which is the correct semantics for
 * "end my break", where a request replayed twenty minutes later would be
 * worse than one that failed.
 */
class PhoneLink(context: Context) : DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {

    private val app = context.applicationContext
    private val dataClient: DataClient = Wearable.getDataClient(app)
    private val messageClient: MessageClient = Wearable.getMessageClient(app)
    private val nodeClient = Wearable.getNodeClient(app)

    private val _state = MutableStateFlow(WatchState())
    val state: StateFlow<WatchState> = _state

    /** The phone's answer to the last command, for the screen that asked. */
    private val _lastReply = MutableStateFlow<String?>(null)
    val lastReply: StateFlow<String?> = _lastReply

    fun start() {
        dataClient.addListener(this)
        messageClient.addListener(this)
        // The store already holds whatever the phone last said, so read it
        // rather than waiting for a change that may not come for hours.
        readCurrent()
    }

    fun stop() {
        dataClient.removeListener(this)
        messageClient.removeListener(this)
    }

    private fun readCurrent() {
        dataClient.dataItems.addOnSuccessListener { buffer ->
            try {
                for (item in buffer) {
                    if (item.uri.path != Paths.STATE) continue
                    val json = DataMapItem.fromDataItem(item).dataMap.getString("json") ?: continue
                    _state.value = WatchState.parse(json)
                }
            } finally {
                buffer.release()
            }
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        try {
            for (event in events) {
                if (event.type != DataEvent.TYPE_CHANGED) continue
                if (event.dataItem.uri.path != Paths.STATE) continue
                val json = DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") ?: continue
                _state.value = WatchState.parse(json)
            }
        } finally {
            events.release()
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != Paths.REPLY) return
        _lastReply.value = String(event.data)
    }

    fun clearReply() {
        _lastReply.value = null
    }

    /**
     * Ask the phone for something.
     *
     * Sent to every connected node rather than a remembered one: a phone that
     * was replaced, or a watch paired to a second handset, should not need
     * the app reinstalled to work again.
     *
     * Returns false when there is nothing to send to, which the screen shows
     * as "Phone not connected" — a true and actionable statement, unlike a
     * spinner that never resolves.
     */
    suspend fun send(command: String): Boolean {
        val nodes = try {
            suspendCancellableCoroutine<List<Node>> { cont ->
                nodeClient.connectedNodes
                    .addOnSuccessListener { cont.resume(it) }
                    .addOnFailureListener { cont.resume(emptyList()) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "connectedNodes failed", e)
            emptyList()
        }
        if (nodes.isEmpty()) return false

        var sentToAny = false
        for (node in nodes) {
            try {
                suspendCancellableCoroutine<Unit> { cont ->
                    messageClient.sendMessage(node.id, Paths.COMMAND, command.toByteArray())
                        .addOnSuccessListener { sentToAny = true; cont.resume(Unit) }
                        .addOnFailureListener { cont.resume(Unit) }
                }
            } catch (e: Exception) {
                Log.w(TAG, "sendMessage failed", e)
            }
        }
        return sentToAny
    }

    private companion object {
        const val TAG = "WorkfenceWear"
    }
}
