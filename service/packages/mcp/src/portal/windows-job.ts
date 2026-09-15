import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Fixed trusted broker code. Project values are XML data, never PowerShell or C# source.
const broker = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,System.Xml.dll -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;
using System.IO;
using System.IO.Pipes;
public static class SfpNativeJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic; public Io Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static bool Drain(IntPtr job) {
    IntPtr buffer = Marshal.AllocHGlobal(8 + 4096 * IntPtr.Size);
    try {
      for (int pass=0;pass<100;pass++) {
        if (!QueryInformationJobObject(job, 3, buffer, (uint)(8+4096*IntPtr.Size), IntPtr.Zero)) return false;
        int count=Marshal.ReadInt32(buffer,4); if(count<1 || count>4096)return false;
        bool others=false;
        for(int i=0;i<count;i++) {
          uint pid=(uint)Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64();
          if(pid==(uint)Process.GetCurrentProcess().Id)continue;
          others=true;
          IntPtr handle=OpenProcess(0x1001,false,pid);
          if(handle==IntPtr.Zero)continue;
          try { bool member; if(!IsProcessInJob(handle,job,out member))return false;
            // A recycled PID belonging to another job is never terminated.
            if(member && !TerminateProcess(handle,125))return false;
          } finally {CloseHandle(handle);}
        }
        if(!others)return true;
        Thread.Sleep(25);
      }
      return false;
    } finally {Marshal.FreeHGlobal(buffer);}
  }
  // CommandLineToArgvW-compatible quoting, including trailing slashes and empty arguments.
  static string Quote(string value) {
    var result = new System.Text.StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
      else { result.Append('\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); return result.Append('"').ToString();
  }
  public static void Run() {
    var doc = new XmlDocument(); doc.XmlResolver = null;
    doc.LoadXml(Environment.GetEnvironmentVariable("SFP_NATIVE_JOB_DATA"));
    Environment.SetEnvironmentVariable("SFP_NATIVE_JOB_DATA", null);
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var limits = new Extended(); limits.Basic.Flags = 0x2000;
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
      Environment.Exit(126);
    string pipeName=doc.DocumentElement.GetAttribute("pipe"), controlToken=doc.DocumentElement.GetAttribute("token");
    NamedPipeClientStream pipe=null; StreamReader reader=null; StreamWriter writer=null;
    var stop=new ManualResetEvent(false); var acknowledgment=new ManualResetEvent(false);
    // The parent pipe is private protocol, never project stdout/stderr. No project process exists
    // until the owner has persisted broker PID, birth identity and launch ownership.
    if(pipeName.Length>0) {
      pipe=new NamedPipeClientStream(".",pipeName,PipeDirection.InOut,PipeOptions.Asynchronous); pipe.Connect(5000);
      reader=new StreamReader(pipe); writer=new StreamWriter(pipe); writer.AutoFlush=true;
      writer.WriteLine("READY|"+controlToken+"|"+Process.GetCurrentProcess().Id+"|"+Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
      string permission=reader.ReadLine();
      Task.Run(()=>{try{string command;while((command=reader.ReadLine())!=null){if(command=="ACK")acknowledgment.Set();else stop.Set();}}finally{stop.Set();}});
      if(permission!="PERMIT") {
        if(Drain(job)) {
          writer.WriteLine("STOPPED|"+controlToken+"|"+Process.GetCurrentProcess().Id+"|"+Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
          acknowledgment.WaitOne(5000);
        }
        Environment.Exit(125);
      }
    }
    // EOF remains a parent-death safeguard, including the no-lifecycle compatibility path.
    Task.Run(() => { try { while(Console.In.Read() >= 0) {} } finally { stop.Set(); } });
    var timer = new Timer(_ => stop.Set(), null, int.Parse(doc.DocumentElement.GetAttribute("timeout")), Timeout.Infinite);
    var info = new ProcessStartInfo();
    info.FileName = doc.DocumentElement.GetAttribute("executable");
    info.WorkingDirectory = doc.DocumentElement.GetAttribute("cwd");
    info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardInput = true;
    var arguments = new System.Collections.Generic.List<string>();
    foreach(XmlNode node in doc.DocumentElement.ChildNodes) arguments.Add(Quote(node.InnerText));
    info.Arguments = string.Join(" ", arguments.ToArray());
    var child = Process.Start(info); child.StandardInput.Close();
    while(!child.WaitForExit(25) && !stop.WaitOne(0)) {}
    int code = child.HasExited ? child.ExitCode : 124;
    bool drained=Drain(job);
    if(writer!=null && drained) {
      writer.WriteLine("STOPPED|"+controlToken+"|"+Process.GetCurrentProcess().Id+"|"+Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
      // Process exit is not a substitute for delivery and durable owner acknowledgment.
      if(!acknowledgment.WaitOne(5000))code=126;
    }
    if(!drained)code=126;
    GC.KeepAlive(timer); GC.KeepAlive(job);
    // The OS closes our sole non-inherited job handle and kills remaining descendants.
    Environment.Exit(code);
  }
}
'@
[SfpNativeJob]::Run()
`;
export const windowsJobProgramHash =
  `sha256:${createHash('sha256').update(broker).digest('hex')}` as const;
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');

export const windowsJobCommand = (
  systemRoot: string,
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  pipeName = '',
  controlToken = '',
) => ({
  executable: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  args: [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(broker, 'utf16le').toString('base64'),
  ],
  data: `<job token="${xml(controlToken)}" pipe="${xml(pipeName)}" timeout="${timeoutMs}" executable="${xml(executable)}" cwd="${xml(cwd)}">${args.map(arg => `<arg>${xml(arg)}</arg>`).join('')}</job>`,
});
