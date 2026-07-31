// Modified from AionCore by WINK GO contributors in 2026.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const MANAGED_RESOURCES_CONTRACT_FILE: &str = "manifest.json";
pub const MANAGED_RESOURCES_CONTRACT_SCHEMA_VERSION: u8 = 2;
const SUPPORTED_RUNTIME_KEYS: [&str; 6] = [
    "win32-x64",
    "win32-arm64",
    "darwin-x64",
    "darwin-arm64",
    "linux-x64",
    "linux-arm64",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedResourcesContract {
    pub schema_version: u8,
    pub runtime_key: String,
    pub node: ManagedNodeResourceContract,
    pub clis: Vec<ManagedCliResourceContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedNodeResourceContract {
    pub version: String,
    pub root: String,
    pub executable: String,
    /// Legal/runtime files that must remain beside the official Node.js
    /// distribution. `LICENSE` is mandatory for every bundled platform.
    #[serde(default)]
    pub required_files: Vec<String>,
}

/// Historical managed-CLI contract shape retained for schema compatibility.
/// Claude Code and Codex are external user-installed tools and are forbidden
/// from managed resource contracts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedCliResourceContract {
    pub name: String,
    pub version: String,
    /// Relative to the managed-resources root.
    pub root: String,
    /// Must equal the contract `runtime_key`.
    pub platform_directory: String,
    /// The main executable, relative to `root`.
    pub executable: String,
    /// Extra files that must exist relative to `root`.
    #[serde(default)]
    pub required_files: Vec<String>,
    /// Extra directories that must exist relative to `root`. May be empty.
    #[serde(default)]
    pub required_directories: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct ManagedResourcesContractError {
    message: String,
}

impl ManagedResourcesContractError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    fn io(action: &str, path: &Path, error: std::io::Error) -> Self {
        Self::invalid(format!("{action} {}: {error}", path.display()))
    }
}

pub fn validate_contract(
    root: &Path,
    contract: &ManagedResourcesContract,
) -> Result<(), ManagedResourcesContractError> {
    validate_schema(contract)?;
    validate_node_schema(&contract.node)?;
    validate_clis_schema(contract)?;
    validate_node_paths(root, &contract.node)?;
    for cli in &contract.clis {
        validate_cli_paths(root, cli)?;
    }
    Ok(())
}

pub fn write_contract(
    root: &Path,
    contract: &ManagedResourcesContract,
) -> Result<PathBuf, ManagedResourcesContractError> {
    validate_contract(root, contract)?;
    let path = root.join(MANAGED_RESOURCES_CONTRACT_FILE);
    let mut contents = serde_json::to_string_pretty(contract).map_err(|error| {
        ManagedResourcesContractError::invalid(format!("serialize managed resources contract: {error}"))
    })?;
    contents.push('\n');
    fs::write(&path, contents).map_err(|error| ManagedResourcesContractError::io("write contract", &path, error))?;
    Ok(path)
}

pub fn relative_contract_path(base: &Path, path: &Path) -> Result<String, ManagedResourcesContractError> {
    let relative = path.strip_prefix(base).map_err(|_| {
        ManagedResourcesContractError::invalid(format!(
            "path {} is not under managed resources root {}",
            path.display(),
            base.display()
        ))
    })?;
    let value = relative.to_string_lossy().replace('\\', "/");
    validate_contract_relative_path(&value)?;
    Ok(value)
}

fn validate_schema(contract: &ManagedResourcesContract) -> Result<(), ManagedResourcesContractError> {
    if contract.schema_version != MANAGED_RESOURCES_CONTRACT_SCHEMA_VERSION {
        return Err(ManagedResourcesContractError::invalid(format!(
            "unsupported schemaVersion {}",
            contract.schema_version
        )));
    }
    require_non_empty("runtimeKey", &contract.runtime_key)?;
    if !SUPPORTED_RUNTIME_KEYS.contains(&contract.runtime_key.as_str()) {
        return Err(ManagedResourcesContractError::invalid(format!(
            "unsupported runtimeKey {}",
            contract.runtime_key
        )));
    }
    Ok(())
}

fn validate_node_schema(node: &ManagedNodeResourceContract) -> Result<(), ManagedResourcesContractError> {
    require_non_empty("node.version", &node.version)?;
    validate_contract_relative_path_field("node.root", &node.root)?;
    validate_contract_relative_path_field("node.executable", &node.executable)?;
    for (index, entry) in node.required_files.iter().enumerate() {
        validate_contract_relative_path_field(format!("node.requiredFiles[{index}]"), entry)?;
    }
    if !node.required_files.iter().any(|entry| entry == "LICENSE") {
        return Err(ManagedResourcesContractError::invalid(
            "node.requiredFiles must include LICENSE",
        ));
    }
    if !node.required_files.iter().any(|entry| {
        matches!(
            entry.as_str(),
            "node_modules/npm/LICENSE" | "lib/node_modules/npm/LICENSE"
        )
    }) {
        return Err(ManagedResourcesContractError::invalid(
            "node.requiredFiles must include the bundled npm LICENSE",
        ));
    }
    Ok(())
}

fn validate_clis_schema(contract: &ManagedResourcesContract) -> Result<(), ManagedResourcesContractError> {
    let mut names = HashSet::new();

    for cli in &contract.clis {
        require_non_empty("clis[].name", &cli.name)?;
        if matches!(cli.name.to_ascii_lowercase().as_str(), "claude" | "codex") {
            return Err(ManagedResourcesContractError::invalid(
                "forbidden bundled external CLI contract entry",
            ));
        }
        if !names.insert(cli.name.as_str()) {
            return Err(ManagedResourcesContractError::invalid(format!(
                "duplicate clis name {}",
                cli.name
            )));
        }

        let label = format!("clis[{}]", cli.name);
        require_non_empty(format!("{label}.version"), &cli.version)?;
        validate_contract_relative_path_field(format!("{label}.root"), &cli.root)?;
        require_non_empty(format!("{label}.platformDirectory"), &cli.platform_directory)?;
        if cli.platform_directory != contract.runtime_key {
            return Err(ManagedResourcesContractError::invalid(format!(
                "clis[{}].platformDirectory {} does not match runtimeKey {}",
                cli.name, cli.platform_directory, contract.runtime_key
            )));
        }
        validate_contract_relative_path_field(format!("{label}.executable"), &cli.executable)?;
        for (index, entry) in cli.required_files.iter().enumerate() {
            validate_contract_relative_path_field(format!("{label}.requiredFiles[{index}]"), entry)?;
        }
        for (index, entry) in cli.required_directories.iter().enumerate() {
            validate_contract_relative_path_field(format!("{label}.requiredDirectories[{index}]"), entry)?;
        }
    }

    Ok(())
}

fn validate_node_paths(root: &Path, node: &ManagedNodeResourceContract) -> Result<(), ManagedResourcesContractError> {
    let node_root = root.join(&node.root);
    if !node_root.is_dir() {
        return Err(ManagedResourcesContractError::invalid(format!(
            "required directory missing: {}",
            node_root.display()
        )));
    }
    let executable = node_root.join(&node.executable);
    if !executable.is_file() {
        return Err(ManagedResourcesContractError::invalid(format!(
            "required file missing: {}",
            executable.display()
        )));
    }
    for required_file in &node.required_files {
        let path = node_root.join(required_file);
        if !path.is_file() {
            return Err(ManagedResourcesContractError::invalid(format!(
                "required file missing: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_cli_paths(root: &Path, cli: &ManagedCliResourceContract) -> Result<(), ManagedResourcesContractError> {
    let cli_root = root.join(&cli.root);
    if !cli_root.is_dir() {
        return Err(ManagedResourcesContractError::invalid(format!(
            "required directory missing: {}",
            cli_root.display()
        )));
    }

    let executable = cli_root.join(&cli.executable);
    if !executable.is_file() {
        return Err(ManagedResourcesContractError::invalid(format!(
            "required file missing: {}",
            executable.display()
        )));
    }

    for required_file in &cli.required_files {
        let path = cli_root.join(required_file);
        if !path.is_file() {
            return Err(ManagedResourcesContractError::invalid(format!(
                "required file missing: {}",
                path.display()
            )));
        }
    }
    for required_directory in &cli.required_directories {
        let path = cli_root.join(required_directory);
        if !path.is_dir() {
            return Err(ManagedResourcesContractError::invalid(format!(
                "required directory missing: {}",
                path.display()
            )));
        }
    }

    Ok(())
}

fn require_non_empty(field: impl std::fmt::Display, value: &str) -> Result<(), ManagedResourcesContractError> {
    if value.is_empty() {
        return Err(ManagedResourcesContractError::invalid(format!("{field} is required")));
    }
    Ok(())
}

fn validate_contract_relative_path_field(
    field: impl std::fmt::Display,
    value: &str,
) -> Result<(), ManagedResourcesContractError> {
    validate_contract_relative_path(value)
        .map_err(|error| ManagedResourcesContractError::invalid(format!("{field}: {error}")))
}

fn validate_contract_relative_path(value: &str) -> Result<(), ManagedResourcesContractError> {
    if value.is_empty()
        || value.contains('\\')
        || Path::new(value).is_absolute()
        || Path::new(value)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ManagedResourcesContractError::invalid(format!(
            "invalid relative contract path {value:?}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_contract(runtime_key: &str) -> ManagedResourcesContract {
        ManagedResourcesContract {
            schema_version: MANAGED_RESOURCES_CONTRACT_SCHEMA_VERSION,
            runtime_key: runtime_key.into(),
            node: ManagedNodeResourceContract {
                version: "24.11.0".into(),
                root: "node/node-v24.11.0-win-x64".into(),
                executable: "node.exe".into(),
                required_files: vec!["LICENSE".into(), "node_modules/npm/LICENSE".into()],
            },
            clis: vec![],
        }
    }

    fn example_external_cli(name: &str) -> ManagedCliResourceContract {
        ManagedCliResourceContract {
            name: name.into(),
            version: "1.0.0".into(),
            root: format!("cli/{name}/1.0.0/win32-x64"),
            platform_directory: "win32-x64".into(),
            executable: "agent.exe".into(),
            required_files: vec![],
            required_directories: vec![],
        }
    }

    fn materialize_node(root: &Path) {
        let node = root.join("node").join("node-v24.11.0-win-x64");
        std::fs::create_dir_all(node.join("node_modules").join("npm")).expect("create npm dir");
        for path in [
            node.join("node.exe"),
            node.join("LICENSE"),
            node.join("node_modules/npm/LICENSE"),
        ] {
            std::fs::write(path, b"license-or-runtime").expect("write required node file");
        }
    }

    #[test]
    fn contract_serializes_v2_camel_case_schema() {
        let contract = example_contract("win32-x64");
        let value = serde_json::to_value(&contract).expect("serialize");

        assert_eq!(value["schemaVersion"], 2);
        assert_eq!(value["runtimeKey"], "win32-x64");
        assert!(value.get("schema_version").is_none());
        assert_eq!(value["node"]["requiredFiles"][0], "LICENSE");
        assert_eq!(value["clis"], serde_json::json!([]));
    }

    #[test]
    fn validate_contract_rejects_duplicate_cli_names() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mut contract = example_contract("win32-x64");
        contract.clis.push(example_external_cli("open-agent"));
        contract.clis.push(example_external_cli("open-agent"));

        let error = validate_contract(temp.path(), &contract).expect_err("duplicate name should fail");

        assert!(error.to_string().contains("duplicate clis name open-agent"));
    }

    #[test]
    fn validate_contract_allows_no_managed_clis() {
        let temp = tempfile::tempdir().expect("tempdir");
        let contract = example_contract("win32-x64");
        materialize_node(temp.path());

        validate_contract(temp.path(), &contract).expect("external CLIs are not part of managed resources");
    }

    #[test]
    fn validate_contract_rejects_bundled_external_clis() {
        for name in ["claude", "codex"] {
            let temp = tempfile::tempdir().expect("tempdir");
            let mut contract = example_contract("win32-x64");
            contract.clis.push(example_external_cli(name));

            let error = validate_contract(temp.path(), &contract).expect_err("external CLI bundle should fail");
            assert!(error.to_string().contains("forbidden bundled external CLI"));
        }
    }

    #[test]
    fn validate_contract_rejects_unsafe_relative_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        for bad in ["/abs/path", "cli\\codex", "", "../escape", "cli/../escape"] {
            let mut contract = example_contract("win32-x64");
            contract.clis.push(example_external_cli("open-agent"));
            contract.clis[0].root = bad.into();

            let error = validate_contract(temp.path(), &contract).expect_err("unsafe path should fail");

            assert!(error.to_string().contains("invalid relative contract path"), "{error}");
        }
    }

    #[test]
    fn validate_contract_rejects_platform_mismatch() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mut contract = example_contract("win32-x64");
        contract.clis.push(example_external_cli("open-agent"));
        contract.clis[0].platform_directory = "linux-x64".into();

        let error = validate_contract(temp.path(), &contract).expect_err("platform mismatch should fail");
        assert!(
            error
                .to_string()
                .contains("platformDirectory linux-x64 does not match runtimeKey win32-x64")
        );
    }

    #[test]
    fn validate_contract_rejects_missing_required_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let contract = example_contract("win32-x64");
        std::fs::create_dir_all(temp.path().join("node").join("node-v24.11.0-win-x64")).expect("create node root");

        let error = validate_contract(temp.path(), &contract).expect_err("missing paths should fail");

        assert!(
            error.to_string().contains("required file missing")
                || error.to_string().contains("required directory missing")
        );
    }
}
