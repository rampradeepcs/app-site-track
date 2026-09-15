package app.workfence.workforce;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The phone's end of the watch link.
 *
 * Two channels, because they answer different questions. The shift snapshot
 * goes onto the Data Layer, which is a replicated store: it survives the
 * watch being out of range, so a wrist raised after an hour in a basement
 * shows the last thing that was true rather than nothing. Commands arrive as
 * messages, delivered now or not at all — the right semantics for "end my
 * break", where a request replayed twenty minutes later would be worse than
 * one that plainly failed.
 *
 * Nothing here decides anything. The web layer owns the rules; this carries
 * the question to it and the answer back, so a company that turns breaks off
 * changes one place and the watch follows.
 */
@CapacitorPlugin(name = "Watch")
public class WatchPlugin extends Plugin implements MessageClient.OnMessageReceivedListener {

    private static final String TAG = "WorkfenceWatch";
    private static final String PATH_STATE = "/workfence/shift";
    private static final String PATH_COMMAND = "/workfence/command";
    private static final String PATH_REPLY = "/workfence/reply";

    /** Commands waiting on the web layer, by the id the watch will be answered
     *  with. Bounded in practice by how fast a thumb can press a watch. */
    private final ConcurrentHashMap<String, String> pending = new ConcurrentHashMap<>();

    @Override
    public void load() {
        Wearable.getMessageClient(getContext()).addListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            Wearable.getMessageClient(getContext()).removeListener(this);
        } catch (Exception e) {
            Log.w(TAG, "removeListener", e);
        }
    }

    /**
     * Is a watch paired and reachable?
     *
     * Also the probe the web layer uses to decide whether this plugin exists
     * at all, so it must answer rather than throw on a phone with no watch.
     */
    @PluginMethod
    public void isReachable(PluginCall call) {
        Wearable.getNodeClient(getContext())
                .getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    JSObject out = new JSObject();
                    out.put("reachable", nodes != null && !nodes.isEmpty());
                    call.resolve(out);
                })
                .addOnFailureListener(e -> {
                    JSObject out = new JSObject();
                    out.put("reachable", false);
                    call.resolve(out);
                });
    }

    /**
     * Replace the snapshot the watch holds.
     *
     * `setUrgent` because the interesting moments are exactly the ones a
     * worker is looking at their wrist for — a break beginning, a boundary
     * crossed — and the default batching can hold those for minutes.
     *
     * The payload is a string rather than a DataMap of fields: one encoder on
     * the web side is easier to keep in step with two decoders than three
     * shapes are, and the whole snapshot is smaller than a single tile.
     */
    @PluginMethod
    public void publish(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("snapshot is required");
            return;
        }
        try {
            PutDataMapRequest req = PutDataMapRequest.create(PATH_STATE);
            req.getDataMap().putString("json", snapshot);
            // Data items are deduplicated by content: without something that
            // changes, an identical snapshot is silently dropped and a watch
            // that missed the first one never hears it.
            req.getDataMap().putLong("at", System.currentTimeMillis());
            PutDataRequest put = req.asPutDataRequest().setUrgent();
            Wearable.getDataClient(getContext())
                    .putDataItem(put)
                    .addOnSuccessListener(r -> call.resolve())
                    .addOnFailureListener(e -> {
                        // A watch that is not listening is the normal case,
                        // not an error worth failing a render over.
                        Log.d(TAG, "publish: no watch listening", e);
                        call.resolve();
                    });
        } catch (Exception e) {
            Log.w(TAG, "publish failed", e);
            call.resolve();
        }
    }

    /** The web layer's answer, sent back to the watch that asked. */
    @PluginMethod
    public void reply(PluginCall call) {
        String id = call.getString("id");
        Boolean ok = call.getBoolean("ok", Boolean.FALSE);
        String reason = call.getString("reason");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        String nodeId = pending.remove(id);
        if (nodeId == null) {
            // The watch went away mid-answer. It will ask again on wake.
            call.resolve();
            return;
        }
        String text = Boolean.TRUE.equals(ok)
                ? (reason == null ? "" : reason)
                : (reason == null || reason.isEmpty() ? "Couldn't do that." : reason);

        // An accepted command needs no words: the new snapshot that follows is
        // the answer, and a watch that says "Done" over a screen already
        // showing the change is one tap nobody needed.
        if (Boolean.TRUE.equals(ok) && text.isEmpty()) {
            call.resolve();
            return;
        }
        Wearable.getMessageClient(getContext())
                .sendMessage(nodeId, PATH_REPLY, text.getBytes(StandardCharsets.UTF_8))
                .addOnCompleteListener(t -> call.resolve());
    }

    @Override
    public void onMessageReceived(MessageEvent event) {
        if (!PATH_COMMAND.equals(event.getPath())) return;
        String command = new String(event.getData(), StandardCharsets.UTF_8);
        String id = UUID.randomUUID().toString();
        pending.put(id, event.getSourceNodeId());

        JSObject data = new JSObject();
        data.put("command", command);
        data.put("id", id);
        notifyListeners("command", data);
    }
}
