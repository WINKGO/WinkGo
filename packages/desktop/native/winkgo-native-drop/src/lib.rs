// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT
// Modified from Wry 0.55.1 by WINK GO contributors in 2026.

#![cfg(windows)]

use napi_derive::napi;
use serde::Serialize;
use std::{
  cell::{RefCell, UnsafeCell},
  ffi::{OsStr, OsString},
  fs::{self, File},
  io::{self, Write},
  mem::size_of,
  os::{raw::c_void, windows::ffi::OsStringExt},
  path::{Path, PathBuf},
  ptr,
  rc::Rc,
  slice,
  sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
  },
  time::{SystemTime, UNIX_EPOCH},
};
use windows::{
  core::{implement, PCWSTR},
  Win32::{
    Foundation::{BOOL, DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINT, POINTL},
    Graphics::Gdi::ScreenToClient,
    System::{
      Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL, TYMED_ISTREAM},
      DataExchange::RegisterClipboardFormatW,
      Memory::{GlobalLock, GlobalSize, GlobalUnlock},
      Ole::{
        IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
        CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
      },
      SystemServices::MODIFIERKEYS_FLAGS,
    },
    UI::{
      Shell::{
        DragFinish, DragQueryFileW, CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW, FILEDESCRIPTORW,
        HDROP,
      },
      WindowsAndMessaging::EnumChildWindows,
    },
  },
};

const MAX_VIRTUAL_FILES: usize = 64;
const MAX_VIRTUAL_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const FILE_ATTRIBUTE_DIRECTORY_VALUE: u32 = 0x10;
static VIRTUAL_DROP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static DROP_EVENTS: OnceLock<Mutex<Vec<NativeDropEvent>>> = OnceLock::new();

thread_local! {
  // IDropTarget is apartment-threaded. Electron calls install_window on its UI
  // thread, so keep the COM references alive on that same thread.
  static DROP_TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum NativeDropEvent {
  Enter {
    names: Vec<String>,
    position: (f64, f64),
  },
  Over { position: (f64, f64) },
  Leave,
  Drop {
    paths: Vec<String>,
    position: (f64, f64),
  },
}

fn push_event(event: NativeDropEvent) {
  if let Ok(mut queue) = DROP_EVENTS.get_or_init(|| Mutex::new(Vec::new())).lock() {
    // Avoid an unbounded queue if the renderer reloads during a drag.
    if queue.len() >= 128 {
      queue.drain(..64);
    }
    queue.push(event);
  }
}

#[derive(Clone)]
struct VirtualFileDescriptor {
  content_index: i32,
  name: OsString,
  is_directory: bool,
}

#[implement(IDropTarget)]
struct NativeDropTarget {
  hwnd: HWND,
  enter_is_valid: UnsafeCell<bool>,
  enter_is_virtual: UnsafeCell<bool>,
  cursor_effect: UnsafeCell<DROPEFFECT>,
}

impl NativeDropTarget {
  fn new(hwnd: HWND) -> Self {
    Self {
      hwnd,
      enter_is_valid: false.into(),
      enter_is_virtual: false.into(),
      cursor_effect: DROPEFFECT_NONE.into(),
    }
  }

  fn sanitize_virtual_filename(raw_name: &OsStr, index: usize) -> OsString {
    let leaf_name = Path::new(raw_name)
      .file_name()
      .unwrap_or_else(|| OsStr::new(""))
      .to_string_lossy();
    let mut sanitized = leaf_name
      .chars()
      .map(|character| {
        if character.is_control()
          || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        {
          '_'
        } else {
          character
        }
      })
      .take(180)
      .collect::<String>();
    sanitized = sanitized
      .trim_matches(|character| character == ' ' || character == '.')
      .to_string();
    if sanitized.is_empty() {
      sanitized = format!("微信文件-{:02}", index + 1);
    }

    let device_stem = sanitized
      .split('.')
      .next()
      .unwrap_or_default()
      .to_ascii_uppercase();
    if matches!(
      device_stem.as_str(),
      "CON"
        | "PRN"
        | "AUX"
        | "NUL"
        | "COM1"
        | "COM2"
        | "COM3"
        | "COM4"
        | "COM5"
        | "COM6"
        | "COM7"
        | "COM8"
        | "COM9"
        | "LPT1"
        | "LPT2"
        | "LPT3"
        | "LPT4"
        | "LPT5"
        | "LPT6"
        | "LPT7"
        | "LPT8"
        | "LPT9"
    ) {
      sanitized.insert(0, '_');
    }
    sanitized.into()
  }

  unsafe fn virtual_file_descriptors(data_obj: &IDataObject) -> Vec<VirtualFileDescriptor> {
    let clipboard_format = RegisterClipboardFormatW(PCWSTR(CFSTR_FILEDESCRIPTORW.as_ptr()));
    if clipboard_format == 0 {
      return Vec::new();
    }
    let descriptor_format = FORMATETC {
      cfFormat: clipboard_format as u16,
      ptd: ptr::null_mut(),
      dwAspect: DVASPECT_CONTENT.0,
      lindex: -1,
      tymed: TYMED_HGLOBAL.0 as u32,
    };
    let mut medium = match data_obj.GetData(&descriptor_format) {
      Ok(value) => value,
      Err(_) => return Vec::new(),
    };
    if medium.tymed != TYMED_HGLOBAL.0 as u32 {
      ReleaseStgMedium(&mut medium);
      return Vec::new();
    }

    let global = medium.u.hGlobal;
    let byte_len = GlobalSize(global);
    let locked = GlobalLock(global);
    if locked.is_null() || byte_len < size_of::<u32>() {
      if !locked.is_null() {
        let _ = GlobalUnlock(global);
      }
      ReleaseStgMedium(&mut medium);
      return Vec::new();
    }

    let declared_count = ptr::read_unaligned(locked.cast::<u32>()) as usize;
    let descriptor_size = size_of::<FILEDESCRIPTORW>();
    let available_count = (byte_len - size_of::<u32>()) / descriptor_size;
    let item_count = declared_count.min(available_count).min(MAX_VIRTUAL_FILES);
    let first_descriptor = locked.cast::<u8>().add(size_of::<u32>());
    let mut descriptors = Vec::with_capacity(item_count);
    for index in 0..item_count {
      let descriptor =
        ptr::read_unaligned(first_descriptor.add(index * descriptor_size).cast::<FILEDESCRIPTORW>());
      let raw_name = ptr::addr_of!(descriptor.cFileName).read_unaligned();
      let name_len = raw_name
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(raw_name.len());
      let raw_name = OsString::from_wide(&raw_name[..name_len]);
      let attributes = ptr::addr_of!(descriptor.dwFileAttributes).read_unaligned();
      descriptors.push(VirtualFileDescriptor {
        content_index: index as i32,
        name: Self::sanitize_virtual_filename(&raw_name, index),
        is_directory: attributes & FILE_ATTRIBUTE_DIRECTORY_VALUE != 0,
      });
    }

    let _ = GlobalUnlock(global);
    ReleaseStgMedium(&mut medium);
    descriptors
  }

  fn virtual_staging_directory() -> io::Result<PathBuf> {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis();
    let sequence = VIRTUAL_DROP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir()
      .join("WINK GO")
      .join("WeChat Drop")
      .join(format!("{}-{timestamp}-{sequence}", std::process::id()));
    fs::create_dir_all(&directory)?;
    Ok(directory)
  }

  fn unique_staging_path(directory: &Path, file_name: &OsStr) -> PathBuf {
    let direct_path = directory.join(file_name);
    if !direct_path.exists() {
      return direct_path;
    }
    let source = Path::new(file_name);
    let stem = source
      .file_stem()
      .unwrap_or_else(|| OsStr::new("微信文件"))
      .to_string_lossy();
    let extension = source.extension().map(|value| value.to_string_lossy());
    for suffix in 2..=999u16 {
      let candidate_name = match &extension {
        Some(extension) if !extension.is_empty() => format!("{stem}-{suffix}.{extension}"),
        _ => format!("{stem}-{suffix}"),
      };
      let candidate = directory.join(candidate_name);
      if !candidate.exists() {
        return candidate;
      }
    }
    directory.join(format!(
      "微信文件-{}",
      VIRTUAL_DROP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
  }

  unsafe fn get_virtual_content_medium(
    data_obj: &IDataObject,
    content_index: i32,
  ) -> io::Result<STGMEDIUM> {
    let clipboard_format = RegisterClipboardFormatW(PCWSTR(CFSTR_FILECONTENTS.as_ptr()));
    if clipboard_format == 0 {
      return Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "FileContents clipboard format is unavailable",
      ));
    }
    let mut last_error = None;
    for medium_type in [TYMED_ISTREAM, TYMED_HGLOBAL] {
      let content_format = FORMATETC {
        cfFormat: clipboard_format as u16,
        ptd: ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: content_index,
        tymed: medium_type.0 as u32,
      };
      match data_obj.GetData(&content_format) {
        Ok(value) => return Ok(value),
        Err(error) => last_error = Some(error.to_string()),
      }
    }
    Err(io::Error::new(
      io::ErrorKind::InvalidData,
      last_error.unwrap_or_else(|| "virtual file content is unavailable".to_string()),
    ))
  }

  unsafe fn write_virtual_content(
    data_obj: &IDataObject,
    content_index: i32,
    target: &Path,
  ) -> io::Result<()> {
    let mut medium = Self::get_virtual_content_medium(data_obj, content_index)?;
    let write_result = if medium.tymed == TYMED_ISTREAM.0 as u32 {
      let stream = (*medium.u.pstm)
        .as_ref()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "virtual file stream is null"));
      match stream {
        Ok(stream) => {
          let mut file = File::create(target)?;
          let mut buffer = [0u8; 64 * 1024];
          let mut total_bytes = 0u64;
          loop {
            let mut bytes_read = 0u32;
            let result = stream.Read(
              buffer.as_mut_ptr().cast(),
              buffer.len() as u32,
              Some(&mut bytes_read),
            );
            if result.is_err() {
              break Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("virtual file stream read failed: {result:?}"),
              ));
            }
            if bytes_read == 0 {
              break Ok(());
            }
            total_bytes = total_bytes.saturating_add(bytes_read as u64);
            if total_bytes > MAX_VIRTUAL_FILE_BYTES {
              break Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "virtual file exceeds the 1 GiB safety limit",
              ));
            }
            file.write_all(&buffer[..bytes_read as usize])?;
          }
        }
        Err(error) => Err(error),
      }
    } else if medium.tymed == TYMED_HGLOBAL.0 as u32 {
      let global = medium.u.hGlobal;
      let byte_len = GlobalSize(global);
      if byte_len as u64 > MAX_VIRTUAL_FILE_BYTES {
        Err(io::Error::new(
          io::ErrorKind::InvalidData,
          "virtual file exceeds the 1 GiB safety limit",
        ))
      } else {
        let locked = GlobalLock(global);
        if locked.is_null() && byte_len > 0 {
          Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "virtual file memory could not be locked",
          ))
        } else {
          let bytes = if byte_len == 0 {
            &[]
          } else {
            slice::from_raw_parts(locked.cast::<u8>(), byte_len)
          };
          let result = File::create(target).and_then(|mut file| file.write_all(bytes));
          if !locked.is_null() {
            let _ = GlobalUnlock(global);
          }
          result
        }
      }
    } else {
      Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "unsupported virtual file storage medium",
      ))
    };
    ReleaseStgMedium(&mut medium);
    if write_result.is_err() {
      let _ = fs::remove_file(target);
    }
    write_result
  }

  unsafe fn materialize_virtual_files(data_obj: &IDataObject) -> Vec<PathBuf> {
    let descriptors = Self::virtual_file_descriptors(data_obj);
    let Ok(staging_directory) = Self::virtual_staging_directory() else {
      return Vec::new();
    };
    let mut paths = Vec::with_capacity(descriptors.len());
    for descriptor in descriptors {
      if descriptor.is_directory {
        continue;
      }
      let target = Self::unique_staging_path(&staging_directory, &descriptor.name);
      if Self::write_virtual_content(data_obj, descriptor.content_index, &target).is_ok() {
        paths.push(target);
      }
    }
    if paths.is_empty() {
      let _ = fs::remove_dir(&staging_directory);
    }
    paths
  }

  unsafe fn normal_paths(data_obj: &IDataObject) -> (Vec<PathBuf>, Option<HDROP>) {
    let drop_format = FORMATETC {
      cfFormat: CF_HDROP.0,
      ptd: ptr::null_mut(),
      dwAspect: DVASPECT_CONTENT.0,
      lindex: -1,
      tymed: TYMED_HGLOBAL.0 as u32,
    };
    let Ok(medium) = data_obj.GetData(&drop_format) else {
      return (Vec::new(), None);
    };
    let hdrop = HDROP(medium.u.hGlobal.0 as _);
    let item_count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
    let mut paths = Vec::with_capacity(item_count as usize);
    for index in 0..item_count {
      let character_count = DragQueryFileW(hdrop, index, None) as usize;
      let mut buffer = vec![0; character_count + 1];
      DragQueryFileW(hdrop, index, Some(&mut buffer));
      paths.push(OsString::from_wide(&buffer[..character_count]).into());
    }
    (paths, Some(hdrop))
  }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for NativeDropTarget_Impl {
  fn DragEnter(
    &self,
    pDataObj: Option<&IDataObject>,
    _grfKeyState: MODIFIERKEYS_FLAGS,
    pt: &POINTL,
    pdwEffect: *mut DROPEFFECT,
  ) -> windows::core::Result<()> {
    let mut client_point = POINT { x: pt.x, y: pt.y };
    let _ = unsafe { ScreenToClient(self.hwnd, &mut client_point) };
    let data_obj = pDataObj.expect("Received null IDataObject");
    let (normal_paths, hdrop) = unsafe { NativeDropTarget::normal_paths(data_obj) };
    let descriptors = if hdrop.is_none() {
      unsafe { NativeDropTarget::virtual_file_descriptors(data_obj) }
    } else {
      Vec::new()
    };
    let names = if hdrop.is_some() {
      normal_paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
    } else {
      descriptors
        .iter()
        .filter(|descriptor| !descriptor.is_directory)
        .map(|descriptor| descriptor.name.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
    };
    let is_valid = !names.is_empty();
    unsafe {
      *self.enter_is_valid.get() = is_valid;
      *self.enter_is_virtual.get() = hdrop.is_none() && is_valid;
      *self.cursor_effect.get() = if is_valid {
        DROPEFFECT_COPY
      } else {
        DROPEFFECT_NONE
      };
      *pdwEffect = *self.cursor_effect.get();
    }
    if is_valid {
      push_event(NativeDropEvent::Enter {
        names,
        position: (client_point.x as f64, client_point.y as f64),
      });
    }
    Ok(())
  }

  fn DragOver(
    &self,
    _grfKeyState: MODIFIERKEYS_FLAGS,
    pt: &POINTL,
    pdwEffect: *mut DROPEFFECT,
  ) -> windows::core::Result<()> {
    if unsafe { *self.enter_is_valid.get() } {
      let mut client_point = POINT { x: pt.x, y: pt.y };
      let _ = unsafe { ScreenToClient(self.hwnd, &mut client_point) };
      push_event(NativeDropEvent::Over {
        position: (client_point.x as f64, client_point.y as f64),
      });
    }
    unsafe {
      *pdwEffect = *self.cursor_effect.get();
    }
    Ok(())
  }

  fn DragLeave(&self) -> windows::core::Result<()> {
    if unsafe { *self.enter_is_valid.get() } {
      push_event(NativeDropEvent::Leave);
    }
    unsafe {
      *self.enter_is_valid.get() = false;
      *self.enter_is_virtual.get() = false;
    }
    Ok(())
  }

  fn Drop(
    &self,
    pDataObj: Option<&IDataObject>,
    _grfKeyState: MODIFIERKEYS_FLAGS,
    pt: &POINTL,
    _pdwEffect: *mut DROPEFFECT,
  ) -> windows::core::Result<()> {
    let is_valid = unsafe { *self.enter_is_valid.get() };
    if is_valid {
      let mut client_point = POINT { x: pt.x, y: pt.y };
      let _ = unsafe { ScreenToClient(self.hwnd, &mut client_point) };
      let data_obj = pDataObj.expect("Received null IDataObject");
      let (mut paths, hdrop) = unsafe { NativeDropTarget::normal_paths(data_obj) };
      if hdrop.is_none() && unsafe { *self.enter_is_virtual.get() } {
        paths = unsafe { NativeDropTarget::materialize_virtual_files(data_obj) };
      }
      push_event(NativeDropEvent::Drop {
        paths: paths
          .into_iter()
          .map(|path| path.to_string_lossy().into_owned())
          .collect(),
        position: (client_point.x as f64, client_point.y as f64),
      });
      if let Some(hdrop) = hdrop {
        unsafe { DragFinish(hdrop) };
      }
    }
    unsafe {
      *self.enter_is_valid.get() = false;
      *self.enter_is_virtual.get() = false;
    }
    Ok(())
  }
}

fn install_for_hwnd(hwnd: HWND) -> bool {
  let target: IDropTarget = NativeDropTarget::new(hwnd).into();
  // Match WINK GO's original Wry integration: only replace a child window
  // that already owns an OLE drop target. Registering every Chromium/D3D
  // child makes Windows route the final Drop to the wrong HWND, which is why
  // WeChat showed the hover panel but never delivered FileContents.
  let revoke_result = unsafe { RevokeDragDrop(hwnd) };
  if revoke_result == Err(DRAGDROP_E_INVALIDHWND.into()) {
    return false;
  }
  let register_result = unsafe { RegisterDragDrop(hwnd, &target) };
  if register_result.is_err() {
    return false;
  }
  DROP_TARGETS.with(|targets| targets.borrow_mut().push(target));
  true
}

#[napi]
pub fn install_window(hwnd_value: i64) -> u32 {
  let root = HWND(hwnd_value as isize as *mut c_void);
  let installed = Rc::new(RefCell::new(0u32));
  {
    let installed = installed.clone();
    let mut callback = move |hwnd| {
      if install_for_hwnd(hwnd) {
        *installed.borrow_mut() += 1;
      }
      true
    };
    let mut callback_trait: &mut dyn FnMut(HWND) -> bool = &mut callback;
    let callback_ptr: *mut c_void = unsafe { std::mem::transmute(&mut callback_trait) };
    let lparam = LPARAM(callback_ptr as isize);
    unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
      let callback = &mut *(lparam.0 as *mut c_void as *mut &mut dyn FnMut(HWND) -> bool);
      callback(hwnd).into()
    }
    let _ = unsafe { EnumChildWindows(root, Some(enumerate_callback), lparam) };
  }
  let result = *installed.borrow();
  result
}

#[napi]
pub fn take_events_json() -> String {
  let events = DROP_EVENTS
    .get_or_init(|| Mutex::new(Vec::new()))
    .lock()
    .map(|mut queue| std::mem::take(&mut *queue))
    .unwrap_or_default();
  serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
  use super::NativeDropTarget;
  use std::ffi::OsStr;

  #[test]
  fn virtual_names_are_safe_leaf_names() {
    assert_eq!(
      NativeDropTarget::sanitize_virtual_filename(OsStr::new(r"..\客户方案?.docx"), 0),
      OsStr::new("客户方案_.docx")
    );
    assert_eq!(
      NativeDropTarget::sanitize_virtual_filename(OsStr::new("CON.txt"), 0),
      OsStr::new("_CON.txt")
    );
  }
}
