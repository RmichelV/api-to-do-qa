import sys
import os
import re
import time
import warnings
import requests
from urllib.parse import urljoin, urlparse

# Suprimir warnings de SSL/urllib3
warnings.filterwarnings('ignore')
requests.packages.urllib3.disable_warnings()
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

# Colores en consola
from colorama import init, Fore, Style
init(autoreset=True)

# pagina de testeo del smart sheet  para hacerle QA
TARGET_URL = ""


#contenido del "content to post" o contenido que se debe incluir en la pagina // siempre en medio de las """ """
RAW_CONTENT_INPUT = """
"""

# Selectores a EXCLUIR antes de comparar texto (unión de ambos scripts)
EXCLUDED_SELECTORS = [
    "div[data-name*='inventory']",
    ".ws-inv-text-search",
    ".ws-inv-filters",
    ".srp-wrapper-listing",
    ".ws-inv-facets",
    ".ws-specials",
    "header",
    ".page-header",
    "footer",
    ".page-footer",
    ".ddc-footer",
    "script",
    "style",
    "noscript"
]

# Wrappers para links
MAIN_CONTENT_WRAPPERS = [".ddc-wrapper"]

# llimpia las etiquetas html del texto
def clean_html_tags(text):
    if not text: return ""
    clean = re.sub(r'<[^>]+>', ' ', text)
    return clean

# normaliza el texto para comparacion
def normalize_text(text):
    if not text:
        return ""
    text = clean_html_tags(text)
    text = text.strip().replace("—", "-").replace("–", "-")
    return " ".join(text.split())

# Clasificación de coincidencias
def classify_match(original_line, page_text_normalized):
    norm_orig = normalize_text(original_line)
    if not norm_orig:
        return None

    if norm_orig in page_text_normalized:
        return (Fore.GREEN, "🟢 EXACTO", original_line)

    cutoff_len = len(norm_orig)
    if cutoff_len > 15:
        half_len = int(cutoff_len * 0.5)
        start_snippet = norm_orig[:half_len]
        if start_snippet in page_text_normalized:
            return (Fore.YELLOW, "🟡 INCOMPLETO/CORTADO", original_line)

    return (Fore.RED, "🔴 NO ENCONTRADO", original_line)

# Lectura de H1
def check_h1s(driver):
    h1s = driver.find_elements(By.TAG_NAME, "h1")
    valid_h1s = []
    ignored_h1_texts = ["oops", "404", "error", "page not found"]

    for h1 in h1s:
        text = h1.text.strip()
        if not text:
            continue
        if any(ignored in text.lower() for ignored in ignored_h1_texts):
            continue
        valid_h1s.append(text)

    print(f"\n{Fore.BLUE}{'='*40}")
    print(f"       ANÁLISIS DE TÍTULOS (H1)")
    print(f"{'='*40}{Style.RESET_ALL}")

    if not valid_h1s:
        print(f"{Fore.RED}No se encontraron etiquetas H1 válidas.{Style.RESET_ALL}")
    elif len(valid_h1s) == 1:
        print(f"H1 único encontrado: {Fore.CYAN}{valid_h1s[0]}{Style.RESET_ALL}")
    else:
        print(f"{Fore.YELLOW}Se encontraron {len(valid_h1s)} etiquetas H1:{Style.RESET_ALL}")
        for i, text in enumerate(valid_h1s, 1):
            print(f"  {i}. {text}")

# Chequeo de links y anclas
def check_links_and_anchors_v4(driver, wrapper_selector):
    print(f"\n{Fore.BLUE}{'='*40}")
    print(f"       ANÁLISIS DE ENLACES (Dentro de {wrapper_selector})")
    print(f"{'='*40}{Style.RESET_ALL}")

    try:
        try:
            wrapper = driver.find_element(By.CSS_SELECTOR, wrapper_selector)
        except:
            clean_class = wrapper_selector.replace(".", "")
            wrapper = driver.find_element(By.CLASS_NAME, clean_class)
        
        links_elements = wrapper.find_elements(By.TAG_NAME, "a")
        buttons_elements = wrapper.find_elements(By.TAG_NAME, "button")
        
        all_elements = links_elements + buttons_elements
        
        print(f"ℹ️  Total elementos interactivos: {len(all_elements)}")

        base_url = driver.current_url
        parsed_base = urlparse(base_url)
        base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"
        
        anchors_to_check = [] 

        for el in all_elements:
            try:
                href = el.get_attribute("href")
                if not href:
                    onclick = el.get_attribute("onclick")
                    if onclick and "location.href" in onclick:
                        match = re.search(r"['\"](.*?)['\"]", onclick)
                        if match:
                            href = match.group(1)
                
                text_preview = el.text.strip()[:30].replace("\n", " ") or "[Sin Texto]"

                if not href:
                    continue
                    
                if href.startswith("tel:") or href.startswith("mailto:") or href.startswith("javascript:"):
                    continue

                if href.startswith("#") or (base_url in href and "#" in href):
                    anchor_id = href.split("#")[-1]
                    if anchor_id:
                        anchors_to_check.append((anchor_id, text_preview))
                    continue

                target_url = urljoin(base_domain, href)

                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Connection': 'keep-alive',
                    }
                    
                    session = requests.Session()
                    # Intentar GET directamente (más confiable que HEAD)
                    response = session.get(target_url, headers=headers, timeout=15, allow_redirects=True, stream=True)
                    status = response.status_code
                    
                    if status >= 400:
                         print(f"{Fore.RED}❌ [{status}] Link Roto: '{text_preview}' -> {target_url}{Style.RESET_ALL}")
                    elif status >= 200 and status < 300:
                         print(f"{Fore.GREEN}✅ [{status}] OK: '{text_preview}' -> {target_url}{Style.RESET_ALL}")
                    else:
                         print(f"{Fore.YELLOW}⚠️  [{status}] Otro: '{text_preview}' -> {target_url}{Style.RESET_ALL}")

                except requests.exceptions.RequestException:
                     print(f"{Fore.YELLOW}⚠️  No se pudo verificar: '{text_preview}' -> {target_url}{Style.RESET_ALL}")

            except Exception:
                continue
        
        # Validación de anclas
        if anchors_to_check:
            print("\nValidando Anclas (Básico)...")
            driver.refresh()
            time.sleep(2)
            for anchor_id, text_prev in anchors_to_check:
                found = False
                try:
                    if driver.find_elements(By.ID, anchor_id) or driver.find_elements(By.NAME, anchor_id):
                        found = True
                except:
                    pass
                
                if found:
                    print(f"[OK] Ancla encontrada: #{anchor_id}")
                else:
                    print(f"[ROTO] Ancla no encontrada: #{anchor_id}")

    except Exception:
        print(f"{Fore.RED}No se encontró el wrapper: {wrapper_selector}{Style.RESET_ALL}")


# funcion principal 
def main():
    expected_content = []
    for line in RAW_CONTENT_INPUT.splitlines():
        if line.strip():
            expected_content.append(line.strip())

    if not expected_content:
        print(f"{Fore.RED}ERROR: No hay contenido para verificar.{Style.RESET_ALL}")
        return

    chrome_options = Options()
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")

    try:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
    except Exception as io_err:
        print(f"{Fore.RED}Error iniciando Chrome Driver: {io_err}{Style.RESET_ALL}")
        return

    try:
        print(f"{Fore.CYAN}🚀 Cargando: {TARGET_URL}{Style.RESET_ALL}")
        driver.get(TARGET_URL)
        time.sleep(3)

        print(f"{Fore.CYAN}ℹ️  Limpiando zonas de inventario, filtros y banners...{Style.RESET_ALL}")
        for selector in EXCLUDED_SELECTORS:
            try:
                driver.execute_script(f"document.querySelectorAll('{selector}').forEach(el => el.remove());")
            except:
                pass

        page_text_norm = normalize_text(driver.find_element(By.TAG_NAME, "body").text)

        found_count = 0
        missing_count = 0

        print(f"\n{Fore.BLUE}{'-'*40}")
        print(f"       RESULTADOS DE COMPARACION")
        print(f"{'-'*40}{Style.RESET_ALL}")

        for line in expected_content:
            norm_orig = normalize_text(line)
            if not norm_orig:
                continue

            display_text = line[:80] + "..." if len(line) > 80 else line

            if norm_orig in page_text_norm:
                print(f"{Fore.GREEN}[Ok]{Style.RESET_ALL} {display_text}")
                found_count += 1
            else:
                cutoff_len = len(norm_orig)
                half_len = int(cutoff_len * 0.5)
                start_snippet = norm_orig[:half_len]

                if cutoff_len > 15 and start_snippet in page_text_norm:
                    print(f"{Fore.YELLOW}[Parcial]{Style.RESET_ALL} {display_text}")
                    found_count += 1
                else:
                    print(f"{Fore.RED}[Falta contenido]{Style.RESET_ALL} {display_text}")
                    missing_count += 1

        print(f"\n{Fore.BLUE}{'-'*50}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}OK: {found_count}{Style.RESET_ALL} | {Fore.RED}FALTAN: {missing_count}{Style.RESET_ALL}")
        print(f"{Fore.BLUE}{'-'*50}{Style.RESET_ALL}")

        # Análisis de H1
        check_h1s(driver)

        # LINK CHECK + ANCHORS
        for wrapper_sel in MAIN_CONTENT_WRAPPERS:
            check_links_and_anchors_v4(driver, wrapper_sel)

    except Exception as e:
        print(f"{Fore.RED}Error: {e}{Style.RESET_ALL}")

    finally:
        print(f"\n{Fore.CYAN}🏁 Finalizando... Cerrando navegador.{Style.RESET_ALL}")
        driver.quit()

if __name__ == "__main__":
    main()
