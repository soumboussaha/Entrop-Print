import os
import time
import zipfile
import logging
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.common.exceptions import (
    WebDriverException,
    NoSuchElementException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ----------------------------- #
#          Logging Setup        #
# ----------------------------- #

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,  # Set to DEBUG to capture all levels of logs
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()  # Logs will be printed to the console
    ]
)
logger = logging.getLogger(__name__)

# ----------------------------- #
#       Helper Functions        #
# ----------------------------- #

def package_extension(extension_dir, output_path):
    """
    Packages the extension directory into a .xpi file.

    :param extension_dir: Path to the extension directory containing manifest.json
    :param output_path: Path where the .xpi file will be saved
    """
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as xpi:
            for root, dirs, files in os.walk(extension_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    # Compute the relative path to maintain directory structure
                    relative_path = os.path.relpath(file_path, extension_dir)
                    xpi.write(file_path, relative_path)
        logger.info(f"Extension packaged as .xpi at: {output_path}")
    except Exception as e:
        logger.error(f"Failed to package extension: {e}")
        raise

def read_links(file_path):
    """
    Reads URLs from a text file, one per line.

    :param file_path: Path to the links list file
    :return: List of URLs
    """
    try:
        with open(file_path, 'r') as file:
            links = [line.strip() for line in file if line.strip()]
        logger.info(f"Read {len(links)} links from {file_path}")
        return links
    except Exception as e:
        logger.error(f"Failed to read links from {file_path}: {e}")
        raise

def format_link(link):
    """
    Ensures the URL starts with http:// or https://

    :param link: URL string
    :return: Formatted URL
    """
    if not link.startswith(('http://', 'https://')):
        formatted = 'http://' + link
        logger.debug(f"Formatted URL: {link} to {formatted}")
        return formatted
    return link

def log_url_state(log_file_path, link, status, error_message=None, final_state=None):
    """
    Logs the state of the visited URL to a file.

    :param log_file_path: Path to the URL log file
    :param link: The URL visited
    :param status: Status of the visit ('success', 'failed_to_load', 'error')
    :param error_message: Error message if any
    :param final_state: Final readyState of the page
    """
    try:
        with open(log_file_path, 'a') as log_file:
            log_file.write(f"URL: {link}\n")
            if status == "success":
                log_file.write(f"Visited successfully. Final state: {final_state}\n")
            elif status == "failed_to_load":
                log_file.write(f"Failed to load after timeout. Final state: {final_state}\n")
            elif status == "error":
                log_file.write(f"Error: {error_message}. Final state: {final_state}\n")
            log_file.write("\n")
        logger.debug(f"Logged URL state for {link}: {status}")
    except Exception as e:
        logger.error(f"Failed to log URL state for {link}: {e}")

def log_console_output(console_log_file_path, link, console_logs):
    """
    Logs browser console output to a separate file.

    :param console_log_file_path: Path to the console log file
    :param link: The URL visited
    :param console_logs: List of console log entries
    """
    try:
        with open(console_log_file_path, 'a') as log_file:
            log_file.write(f"URL: {link}\n")
            if console_logs:
                log_file.write("Browser Console Logs:\n")
                for entry in console_logs:
                    log_file.write(f"{entry['level']}: {entry['message']}\n")
            else:
                log_file.write("No console logs found.\n")
            log_file.write("\n")
        logger.debug(f"Logged console output for {link}")
    except Exception as e:
        logger.error(f"Failed to log console output for {link}: {e}")

def set_extension_settings(driver, mode, threshold):
    """
    Sends a message to the extension's background script to set mode and threshold.

    :param driver: Selenium WebDriver instance
    :param mode: Mode to set ('entropy' or 'random')
    :param threshold: Entropy threshold value
    """
    try:
        script = f"""
        browser.runtime.sendMessage({{
            setMode: '{mode}',
            setEntropyThreshold: {threshold}
        }}).then(response => {{
            console.log('Extension settings updated:', response.status);
        }}).catch(error => {{
            console.error('Error updating extension settings:', error);
        }});
        """
        driver.execute_script(script)
        logger.info(f"Sent settings to extension: mode={mode}, threshold={threshold}")
        # Wait briefly to allow the extension to process the settings
        time.sleep(2)
    except Exception as e:
        logger.error(f"Error sending settings to extension: {e}")

# ----------------------------- #
#         Main Function         #
# ----------------------------- #

def open_links_in_firefox(
    links,
    extension_dir,
    geckodriver_path,
    mode,
    threshold,
    log_url_file,
    log_console_file,
    firefox_binary_path=None,
    timeout=30
):
    """
    Opens links in Firefox with the FP-Tracer extension configured per settings,
    logs URL states and browser console outputs.

    :param links: List of URLs to visit
    :param extension_dir: Path to the extension directory containing manifest.json
    :param geckodriver_path: Path to the geckodriver executable
    :param mode: Mode to set in the extension ('entropy' or 'random')
    :param threshold: Entropy threshold value
    :param log_url_file: Path to the URL log file
    :param log_console_file: Path to the console log file
    :param firefox_binary_path: Path to the Firefox binary (optional)
    :param timeout: Timeout in seconds for page loading
    """
    # Temporary path for the packaged extension
    packaged_extension_path = os.path.join(os.path.dirname(extension_dir), "temp_fp_tracer_extension.xpi")
    
    # Package the extension directory into a .xpi file
    try:
        package_extension(extension_dir, packaged_extension_path)
    except Exception as e:
        logger.critical("Cannot proceed without a valid extension package.")
        return
    
    # Set up Firefox options
    options = Options()
    options.headless = True  # Set to False if you want to see the browser
    options.add_extension(packaged_extension_path)
    
    if firefox_binary_path:
        options.binary_location = firefox_binary_path
        logger.debug(f"Using custom Firefox binary at: {firefox_binary_path}")
    
    # Set desired capabilities for capturing console logs
    capabilities = DesiredCapabilities.FIREFOX.copy()
    capabilities['moz:firefoxOptions'] = {'log': {'level': 'trace'}}
    
    # Initialize WebDriver
    service = Service(executable_path=geckodriver_path)
    try:
        driver = webdriver.Firefox(service=service, options=options, desired_capabilities=capabilities)
        logger.info("Firefox launched successfully.")
    except Exception as e:
        logger.critical(f"Failed to start Firefox: {e}")
        # Clean up the packaged extension file before exiting
        if os.path.exists(packaged_extension_path):
            os.remove(packaged_extension_path)
            logger.debug(f"Temporary extension file removed: {packaged_extension_path}")
        return
    
    try:
        # Allow some time for the extension to load
        logger.debug("Waiting for the extension to initialize...")
        time.sleep(3)
        
        # Configure the extension's settings via injected JavaScript
        set_extension_settings(driver, mode, threshold)
        
        # Iterate through each link and perform crawling
        for link in links:
            formatted_link = format_link(link)
            logger.info(f"Navigating to: {formatted_link}")
            try:
                driver.get(formatted_link)
                logger.debug(f"Opened {formatted_link}")
                
                # Wait for the page to load completely by checking the readyState
                page_loaded = False
                final_state = None
                for i in range(timeout):
                    final_state = driver.execute_script("return document.readyState")
                    if final_state == "complete":
                        page_loaded = True
                        logger.debug(f"Page loaded: {formatted_link} (readyState: {final_state})")
                        break
                    time.sleep(1)
                
                if page_loaded:
                    log_url_state(log_url_file, formatted_link, "success", final_state=final_state)
                    logger.info(f"Page loaded successfully: {formatted_link}")
                else:
                    log_url_state(log_url_file, formatted_link, "failed_to_load", final_state=final_state)
                    logger.warning(f"Page failed to load within timeout: {formatted_link}")
                
                # Fetch browser console logs
                try:
                    console_logs = driver.get_log('browser')
                    logger.debug(f"Fetched console logs for {formatted_link}")
                except Exception as e:
                    console_logs = []
                    logger.error(f"Error fetching console logs for {formatted_link}: {e}")
                
                # Log console output
                log_console_output(log_console_file, formatted_link, console_logs)
            
            except WebDriverException as e:
                # Fetch console logs even if there's an error
                try:
                    console_logs = driver.get_log('browser')
                    logger.debug(f"Fetched console logs for {formatted_link} after WebDriverException")
                except Exception:
                    console_logs = []
                final_state = driver.execute_script("return document.readyState")
                log_url_state(log_url_file, formatted_link, "error", str(e), final_state=final_state)
                log_console_output(log_console_file, formatted_link, console_logs)
                logger.error(f"Error loading {formatted_link}: {e}")
                continue  # Skip to the next link
    
    except Exception as e:
        logger.critical(f"An unexpected error occurred during crawling: {e}")
    
    finally:
        # Close the browser window
        driver.quit()
        logger.info("Firefox closed.")
        
        # Optionally, remove the temporary .xpi file
        if os.path.exists(packaged_extension_path):
            os.remove(packaged_extension_path)
            logger.debug(f"Temporary extension file removed: {packaged_extension_path}")

# ----------------------------- #
#          Script Entry         #
# ----------------------------- #

if __name__ == "__main__":
    # Define your configurations with corrected threshold
    configurations = [
        {"mode": "entropy", "threshold": 1.0, "log_url": "url_log_1.0.txt", "log_console": "console_log_1.0.txt"},  # Corrected threshold
        {"mode": "entropy", "threshold": 0.83, "log_url": "url_log_0.83.txt", "log_console": "console_log_0.83.txt"},
        {"mode": "entropy", "threshold": 0.705, "log_url": "url_log_0.705.txt", "log_console": "console_log_0.705.txt"},
        {"mode": "entropy", "threshold": 0.596, "log_url": "url_log_0.596.txt", "log_console": "console_log_0.596.txt"},
        {"mode": "entropy", "threshold": 0.442, "log_url": "url_log_0.442.txt", "log_console": "console_log_0.442.txt"},
    ]
    
    try:
        # Ask user for the file path to the links list
        links_file_path = input("Enter the path to the links list file: ").strip()
        if not os.path.exists(links_file_path):
            logger.critical(f"Links file not found: {links_file_path}")
            exit(1)
        
        # Read links from the specified file
        links = read_links(links_file_path)
        
        # Ask user for the extension directory path
        extension_dir = input("Enter the path to your extension directory (containing manifest.json): ").strip()
        if not os.path.exists(extension_dir):
            logger.critical(f"Extension directory not found: {extension_dir}")
            exit(1)
        
        # Ask user for the geckodriver path
        geckodriver_path = input("Enter the path to the geckodriver executable: ").strip()
        if not os.path.exists(geckodriver_path):
            logger.critical(f"Geckodriver not found: {geckodriver_path}")
            exit(1)
        
        # Optionally, ask for Firefox binary location
        firefox_binary_path = input("Enter the path to the Firefox binary (press Enter to use default): ").strip()
        if not firefox_binary_path:
            firefox_binary_path = None  # Use default
        
        # Iterate through each configuration and perform crawling
        for config in configurations:
            mode = config["mode"]
            threshold = config["threshold"]
            log_url_file = config["log_url"]
            log_console_file = config["log_console"]
            logger.info(f"\n--- Starting crawling with mode: {mode}, threshold: {threshold} ---")
        
            # Clear previous logs if they exist
            try:
                if os.path.exists(log_url_file):
                    os.remove(log_url_file)
                    logger.debug(f"Previous URL log removed: {log_url_file}")
                if os.path.exists(log_console_file):
                    os.remove(log_console_file)
                    logger.debug(f"Previous console log removed: {log_console_file}")
            except Exception as e:
                logger.error(f"Error clearing previous logs: {e}")
        
            # Open links in Firefox using the specified configuration and log the results
            open_links_in_firefox(
                links=links,
                extension_dir=extension_dir,
                geckodriver_path=geckodriver_path,
                mode=mode,
                threshold=threshold,
                log_url_file=log_url_file,
                log_console_file=log_console_file,
                firefox_binary_path=firefox_binary_path,
                timeout=30  # Adjust timeout as needed
            )
            logger.info(f"--- Completed crawling with mode: {mode}, threshold: {threshold} ---")
        
        logger.info("\nAll configurations have been processed.")
    
    except KeyboardInterrupt:
        logger.warning("Script interrupted by user. Exiting...")
        exit(0)
    except Exception as e:
        logger.critical(f"An unexpected error occurred: {e}")
        exit(1)
