// Compiled only inside the current task private observation directory.
// Native layouts come from the actual macOS SDK headers at build time.
export const nativeDockerVnodeSource = String.raw`#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <sys/fsgetpath.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void json_string(const char *s) {
  putchar('"');
  for (const unsigned char *p=(const unsigned char*)s; *p; ++p) {
    if (*p=='"' || *p=='\\') printf("\\%c",*p);
    else if (*p<32) printf("\\u%04x",*p);
    else putchar(*p);
  }
  putchar('"');
}
int main(int argc, char **argv) {
  if (argc<2) return 2;
  int pid=atoi(argv[1]);
  if (pid<=0) return 2;
  struct proc_bsdinfo before, after;
  memset(&before,0,sizeof(before)); memset(&after,0,sizeof(after));
  if (proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&before,sizeof(before))!=(int)sizeof(before)) return 3;
  char executable[PROC_PIDPATHINFO_MAXSIZE]; memset(executable,0,sizeof(executable));
  if(proc_pidpath(pid,executable,sizeof(executable))<=0) return 4;
  printf("{\"pid\":%d,\"ppid\":%u,\"uid\":%u,\"startSeconds\":%llu,\"startMicros\":%llu,\"executable\":",pid,before.pbi_ppid,before.pbi_uid,(unsigned long long)before.pbi_start_tvsec,(unsigned long long)before.pbi_start_tvusec);
  json_string(executable);
  printf(",\"expectedSize\":%zu,\"fds\":[",sizeof(struct vnode_fdinfowithpath));
  for(int i=2;i<argc;i++) {
    int fd=atoi(argv[i]); if(fd<0) return 2;
    struct vnode_fdinfowithpath info; memset(&info,0,sizeof(info));
    errno=0;
    int size=proc_pidfdinfo(pid,fd,PROC_PIDFDVNODEPATHINFO,&info,sizeof(info));
    int e=errno;
    if(i>2) putchar(',');
    printf("{\"fd\":%d,\"returnedSize\":%d,\"errno\":%d",fd,size,e);
    if(size==(int)sizeof(info)) {
      struct vinfo_stat *v=&info.pvip.vip_vi.vi_stat;
      printf(",\"device\":%u,\"inode\":%llu,\"nlink\":%u,\"mode\":%u,\"directory\":%s,\"uid\":%u,\"gid\":%u,\"vnodeType\":%d,\"generation\":%u,\"openFlags\":%u,\"statusFlags\":%u,\"fileType\":%d,\"guardFlags\":%u,\"path\":",v->vst_dev,(unsigned long long)v->vst_ino,v->vst_nlink,v->vst_mode,S_ISDIR(v->vst_mode)?"true":"false",v->vst_uid,v->vst_gid,info.pvip.vip_vi.vi_type,v->vst_gen,info.pfi.fi_openflags,info.pfi.fi_status,info.pfi.fi_type,info.pfi.fi_guardflags);
      json_string(info.pvip.vip_path);
      char resolved[4096]; memset(resolved,0,sizeof(resolved));
      errno=0;
      ssize_t fsSize=fsgetpath(resolved,sizeof(resolved),&info.pvip.vip_vi.vi_fsid,v->vst_ino);
      int fe=errno;
      printf(",\"fsgetpathSize\":%zd,\"fsgetpathErrno\":%d,\"fsgetpath\":",fsSize,fe);
      json_string(resolved);
      struct stat s; errno=0; int ok=lstat(info.pvip.vip_path,&s); int se=errno;
      printf(",\"lstatStatus\":%d,\"lstatErrno\":%d",ok,se);
      if(ok==0) printf(",\"pathDevice\":%d,\"pathInode\":%llu,\"pathNlink\":%u,\"pathMode\":%u",s.st_dev,(unsigned long long)s.st_ino,s.st_nlink,s.st_mode);
      char parent[sizeof(info.pvip.vip_path)]; memcpy(parent,info.pvip.vip_path,sizeof(parent)); parent[sizeof(parent)-1]=0;
      char *slash=strrchr(parent,'/'); if(slash && slash!=parent) *slash=0;
      errno=0; int parentOk=lstat(parent,&s); int pe=errno;
      printf(",\"parent\":"); json_string(parent);
      printf(",\"parentStatus\":%d,\"parentErrno\":%d",parentOk,pe);
      if(parentOk==0) printf(",\"parentDevice\":%d,\"parentInode\":%llu,\"parentMode\":%u",s.st_dev,(unsigned long long)s.st_ino,s.st_mode);
    }
    putchar('}');
  }
  if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&after,sizeof(after))!=(int)sizeof(after)) return 5;
  if(before.pbi_pid!=after.pbi_pid || before.pbi_ppid!=after.pbi_ppid || before.pbi_uid!=after.pbi_uid || before.pbi_start_tvsec!=after.pbi_start_tvsec || before.pbi_start_tvusec!=after.pbi_start_tvusec) return 6;
  puts("],\"processStable\":true}");
  return 0;
}
`;
