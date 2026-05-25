// Camera (DualCam) test page. Embeds the isolated camera-test rig (served by
// nginx at /camtest/) so logged-in OYU TOLGOI / NOMIN MOTOR testers can view
// the demo snapshots and request a new photo/video — without the prod app
// owning the camera protocol. Kept as a thin iframe on purpose.
export function Camera() {
  return (
    <div className="h-full flex flex-col bg-slate-100">
      <div className="px-5 py-3 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-bold text-slate-900">Камер · DualCam</h1>
        <p className="text-xs text-slate-500">
          FMC125 + DualCam туршилт — snapshot / видео татах. Demo data.
        </p>
      </div>
      <iframe
        src="/camtest/"
        title="Камер тест"
        className="flex-1 w-full border-0"
        allow="fullscreen"
      />
    </div>
  );
}
